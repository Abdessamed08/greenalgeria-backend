const { MongoClient } = require('mongodb');

// Remplace <PASSWORD> par ton mot de passe exact
const uri = "mongodb+srv://mezianimohamedabdelsamed_db_user:ZrC1a0ARpg5QdGSl@greenalgeriabase.mrvwbhl.mongodb.net/greenalgeriaDB?retryWrites=true&w=majority";

const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db("greenalgeriaDB");
        const collection = db.collection("markers");

        const doc = {
            nom: "Association Al-Khoudra",
            adresse: "Alger, Algérie",
            type: "صنوبر حلبي",
            quantite: 10,
            lat: 36.7525,
            lng: 3.0420,
            photo: "",
            createdAt: new Date()
        };

        const result = await collection.insertOne(doc);
        console.log("Document inséré avec _id :", result.insertedId);
    } catch (err) {
        console.error("Erreur :", err);
    } finally {
        await client.close();
    }
}

run();
