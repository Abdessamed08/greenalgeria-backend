// server.js
require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const NodeCache = require('node-cache');
// const mongoSanitize = require('express-mongo-sanitize');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // accepter images encodées en base64
// app.use(mongoSanitize());

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const NOMINATIM_MIN_GAP_MS = parseInt(process.env.NOMINATIM_MIN_GAP_MS || '500', 10);
const GEO_CACHE_PRECISION = parseInt(process.env.GEO_CACHE_PRECISION || '3', 10);

// 🔹 Créer le dossier uploads s'il n'existe pas (toujours utile en local/fallback)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 🔹 Servir le dossier uploads publiquement (pour fallback local)
app.use("/uploads", express.static(uploadsDir));
app.use("/static", express.static(path.join(__dirname, "static")));

// 🔹 Config Cloudinary
if (process.env.CLOUDINARY_URL) {
    console.log('☁️  Cloudinary activé');
} else {
    console.warn('⚠️  CLOUDINARY_URL manquant - Upload local seulement (éphémère sur Render)');
}

const storage = process.env.CLOUDINARY_URL 
    ? new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'greenalgeria',
            allowed_formats: ['jpg', 'png', 'webp', 'jpeg'],
            transformation: [{ width: 1000, crop: "limit" }]
        },
      })
    : multer.diskStorage({ // Fallback local
        destination: (req, file, cb) => {
            const uploadsDir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
            cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
      });

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error('INVALID_FILE_TYPE'));
  }
});

// 🔹 Rate limits
const contributionsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// 🔹 Validation
const contributionValidators = [
  body('lat').exists().withMessage('lat requis').isFloat({ min: -90, max: 90 }).withMessage('lat invalide'),
  body('lng').exists().withMessage('lng requis').isFloat({ min: -180, max: 180 }).withMessage('lng invalide'),
  body().custom((value) => {
    if (!value || Object.keys(value).length === 0) {
      throw new Error('payload vide');
    }
    return true;
  })
];

function logRequest(routeName) {
    return (req, res, next) => {
        const start = Date.now();
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        res.on('finish', () => {
            const entry = {
                ts: new Date().toISOString(),
                ip,
                method: req.method,
                path: req.originalUrl,
                route: routeName,
                status: res.statusCode,
                durationMs: Date.now() - start,
            };
            console.log(JSON.stringify(entry));
        });
        next();
    };
}

// Route pour upload
app.post('/api/upload', logRequest('upload'), uploadLimiter, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ success: false, error: 'Type de fichier non autorisé' });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'Fichier trop volumineux (max 3MB)' });
      }
      return res.status(400).json({ success: false, error: 'Upload échoué' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Aucun fichier fourni' });
    }
    
    // Si Cloudinary est utilisé, req.file.path contient l'URL sécurisée
    // Sinon, on construit l'URL locale
    const fileUrl = req.file.path || `${BASE_URL}/uploads/${req.file.filename}`;
    
    return res.json({ success: true, url: fileUrl });
  });
});

// 🔹 URI MongoDB depuis variable d'environnement
const uri = process.env.MONGO_URI;
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

const geoCache = new NodeCache({ stdTTL: 3600, useClones: false });
let lastGeoCallTs = 0;

function roundCoordinate(value) {
    const factor = 10 ** GEO_PRECISION;
    return Math.round(value * factor) / factor;
}

function cacheKey(lat, lng) {
    return `${lat.toFixed(GEO_CACHE_PRECISION)}|${lng.toFixed(GEO_CACHE_PRECISION)}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function reverseGeocode(lat, lng) {
    const key = cacheKey(lat, lng);
    const cached = geoCache.get(key);
    if (cached) return cached;

    const now = Date.now();
    const wait = Math.max(0, NOMINATIM_MIN_GAP_MS - (now - lastGeoCallTs));
    if (wait > 0) {
        await sleep(wait);
    }
    lastGeoCallTs = Date.now();

    const params = new URLSearchParams({
        format: 'jsonv2',
        lat: lat.toString(),
        lon: lng.toString(),
        zoom: '13',
        addressdetails: '1'
    });

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
            headers: {
                'User-Agent': GEO_USER_AGENT,
                'Accept-Language': 'ar,en'
            },
            timeout: 8000
        });

        if (!response.ok) {
            throw new Error(`Nominatim error ${response.status}`);
        }

        const payload = await response.json();
        const address = payload.address || {};

        const result = {
            city: address.city || address.town || address.village || address.municipality || address.county || null,
            district: address.suburb || address.neighbourhood || address.city_district || address.state_district || null
        };
        geoCache.set(key, result);
        return result;
    } catch (err) {
        console.warn('⚠️ Reverse geocoding fallback:', err.message);
        return { city: null, district: null };
    }
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
app.post('/api/contributions', logRequest('contributions'), contributionsLimiter, contributionValidators, async (req, res) => {
    try {
        if (!collection) {
            return res.status(503).json({ success: false, error: "Base de données non initialisée" });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, error: "Données invalides", details: errors.array() });
        }

        console.log("📥 Données reçues :", req.body);

        const data = req.body;

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

// 🔹 Endpoint pour récupérer les contributions
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