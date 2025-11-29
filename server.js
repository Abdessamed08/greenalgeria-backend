// server.js
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 URI MongoDB depuis variable d'environnement
const uri = process.env.MONGO_URI; // configure MONGO_URI dans Render
if (!uri) {
    console.error("❌ MONGO_URI non défini !");
    process.exit(1);
}

const client = new MongoClient(uri, {
    tlsAllowInvalidCertificates: true, // pour dev local si besoin
});

let collection;

// 🔹 Connexion MongoDB et démarrage serveur
async function startServer() {
    try {
        await client.connect();
        console.log("✅ MongoDB connecté");

        const db = client.db("greenalgeriaDB");
        collection = db.collection("contributions");

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`🚀 Serveur lancé sur port ${PORT}`));
    } catch (err) {
        console.error("❌ Erreur de connexion MongoDB :", err.message);
    }
}

startServer();

// 🔹 Endpoint pour ajouter une contribution
app.post('/api/contributions', async (req, res) => {
    try {
        console.log("📥 Données reçues :", req.body);

        const data = req.body;
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: "Données vides" });
        }

        const result = await collection.insertOne(data);
        console.log("🌳 Contribution insérée :", result.insertedId);

        res.json({ success: true, insertedId: result.insertedId });
    } catch (error) {
        console.error("❌ Erreur MongoDB :", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
