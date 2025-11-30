// server.js
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // accepter images encodées en base64

// 🔹 Servir le dossier uploads publiquement
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔹 Servir le dossier static (images migrées) publiquement
app.use("/static", express.static(path.join(__dirname, "static")));

// 🔹 Configuration Multer pour le stockage des images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Route pour upload
app.post('/api/upload', upload.single('image'), (req, res) => {
  const fileUrl = `https://greenalgeria-backend.onrender.com/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// 🔹 URI MongoDB depuis variable d'environnement
const uri = process.env.MONGO_URI || "mongodb+srv://abdessamed:abdessamed@cluster0.7j0yq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; // default for local test
if (!uri) {
    console.error("❌ MONGO_URI non défini !");
    process.exit(1);
}

const client = new MongoClient(uri, {
    tlsAllowInvalidCertificates: true, // pour dev local si besoin
});

let collection;

const GEO_USER_AGENT = process.env.NOMINATIM_UA || 'GreenAlgeria/1.0 (+https://greenalgeria.onrender.com)';
const GEO_PRECISION = parseInt(process.env.GEO_ROUND_PRECISION || '4', 10); // ≈ 11m avec 4 décimales

// 🔹 Clé secrète pour la migration admin
const SECRET_KEY = process.env.MIGRATION_SECRET_KEY || 'greenalgeria2025_migration_secret_key_change_me';

function roundCoordinate(value) {
    const factor = 10 ** GEO_PRECISION;
    return Math.round(value * factor) / factor;
}

async function reverseGeocode(lat, lng) {
    const params = new URLSearchParams({
        format: 'jsonv2',
        lat: lat.toString(),
        lon: lng.toString(),
        zoom: '13',
        addressdetails: '1'
    });

    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
        headers: {
            'User-Agent': GEO_USER_AGENT,
            'Accept-Language': 'ar,en'
        }
    });

    if (!response.ok) {
        throw new Error(`Nominatim error ${response.status}`);
    }

    const payload = await response.json();
    const address = payload.address || {};

    return {
        city: address.city || address.town || address.village || address.municipality || address.county || null,
        district: address.suburb || address.neighbourhood || address.city_district || address.state_district || null
    };
}

// 🔹 Connexion MongoDB et démarrage serveur
async function startServer() {
    try {
        // Skip connection if no URI provided for simple local test without DB
        if (uri.includes("cluster0")) { 
             console.warn("⚠️ Using default/local MONGO_URI for testing.");
        }
        
        await client.connect();
        console.log("✅ MongoDB connecté");

        const db = client.db("greenalgeriaDB");
        collection = db.collection("contributions");
    } catch (err) {
        console.error("❌ Erreur de connexion MongoDB :", err.message);
    } finally {
        const PORT = process.env.PORT || 4000;
        app.listen(PORT, () => console.log(`🚀 Serveur lancé sur port ${PORT}`));
    }
}

startServer();

// 🔹 Endpoint pour ajouter une contribution
app.post('/api/contributions', async (req, res) => {
    try {
        if (!collection) {
            return res.status(503).json({ success: false, error: "Base de données non initialisée" });
        }
        console.log("📥 Données reçues :", req.body);

        const data = req.body;
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: "Données vides" });
        }

        const latNum = parseFloat(data.lat);
        const lngNum = parseFloat(data.lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
            return res.status(400).json({ success: false, error: "Coordonnées invalides" });
        }

        const roundedLat = roundCoordinate(latNum);
        const roundedLng = roundCoordinate(lngNum);
        data.lat = roundedLat;
        data.lng = roundedLng;
        data.location = {
            type: 'Point',
            coordinates: [roundedLng, roundedLat],
            lat: roundedLat,
            lng: roundedLng
        };

        try {
            const { city, district } = await reverseGeocode(roundedLat, roundedLng);
            if (city) data.city = city;
            if (district) data.district = district;
            data.geocodedAt = new Date();
        } catch (geoError) {
            console.warn('⚠️ Reverse geocoding échoué:', geoError.message);
        }

        const result = await collection.insertOne(data);
        console.log("🌳 Contribution insérée :", result.insertedId);

        res.json({ success: true, insertedId: result.insertedId });
    } catch (error) {
        console.error("❌ Erreur MongoDB :", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔹 Endpoint pour récupérer les contributions (utile pour recharger les photos Base64)
app.get('/api/contributions', async (req, res) => {
    try {
        if (!collection) {
            return res.status(503).json({ success: false, error: "Base de données non initialisée" });
        }
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const docs = await collection
            .find({})
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        res.json(docs);
    } catch (error) {
        console.error("❌ Erreur lors de la récupération des contributions :", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🔹 Fonction de migration (réutilise la logique de migrateImages.js)
async function runMigration() {
    const STATIC_IMAGES_DIR = path.join(__dirname, 'static', 'images');
    
    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(STATIC_IMAGES_DIR)) {
        fs.mkdirSync(STATIC_IMAGES_DIR, { recursive: true });
    }
    
    /**
     * Convertit une image Base64 en fichier binaire
     */
    function saveBase64ToFile(base64String, outputPath) {
        const matches = base64String.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
            throw new Error('Format Base64 invalide');
        }
        
        const imageType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(outputPath, buffer);
        
        return imageType;
    }
    
    const results = {
        totalFound: 0,
        migratedCount: 0,
        errorCount: 0,
        errors: [],
        destination: STATIC_IMAGES_DIR
    };
    
    try {
        if (!collection) {
            throw new Error("Base de données non initialisée");
        }
        
        // Trouver tous les documents avec des images Base64
        const documentsWithBase64 = await collection.find({
            photo: { $regex: '^data:image/' }
        }).toArray();
        
        results.totalFound = documentsWithBase64.length;
        
        for (const doc of documentsWithBase64) {
            try {
                const docId = doc._id.toString();
                
                // Sauvegarder l'image
                const imageType = saveBase64ToFile(
                    doc.photo,
                    path.join(STATIC_IMAGES_DIR, `${docId}.jpg`)
                );
                
                // Nouvelle URL relative
                const newPhotoUrl = `/static/images/${docId}.jpg`;
                
                // Mettre à jour le document
                const updateResult = await collection.updateOne(
                    { _id: doc._id },
                    { 
                        $set: { 
                            photo: newPhotoUrl,
                            migratedAt: new Date(),
                            originalFormat: imageType
                        } 
                    }
                );
                
                if (updateResult.modifiedCount === 1) {
                    results.migratedCount++;
                } else {
                    results.errorCount++;
                    results.errors.push(`Document ${docId} : Mise à jour échouée`);
                }
                
            } catch (error) {
                results.errorCount++;
                results.errors.push(`Document ${doc._id}: ${error.message}`);
            }
        }
        
        return results;
        
    } catch (error) {
        throw new Error(`Erreur fatale lors de la migration : ${error.message}`);
    }
}

// 🔹 Route Admin pour exécuter la migration (protégée par mot de passe)
app.get('/api/migrate-images-admin', async (req, res) => {
    try {
        // Vérifier la clé secrète
        const providedKey = req.query.key;
        
        if (!providedKey || providedKey !== SECRET_KEY) {
            console.warn('⚠️ Tentative d\'accès non autorisée à la migration');
            return res.status(403).json({ 
                success: false, 
                error: "Accès refusé : Clé secrète invalide" 
            });
        }
        
        console.log('🔐 Clé valide - Démarrage de la migration...');
        
        // Exécuter la migration
        const results = await runMigration();
        
        console.log('✅ Migration terminée');
        console.log(`📊 Images trouvées : ${results.totalFound}`);
        console.log(`✅ Migrées avec succès : ${results.migratedCount}`);
        console.log(`❌ Erreurs : ${results.errorCount}`);
        
        return res.json({
            success: true,
            message: "Migration exécutée avec succès",
            results: {
                totalFound: results.totalFound,
                migratedCount: results.migratedCount,
                errorCount: results.errorCount,
                errors: results.errors.length > 0 ? results.errors : undefined,
                destination: results.destination
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration :', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});