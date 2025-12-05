const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://mezianimohamedabdelsamed_db_user:ZrC1a0ARpg5QdGSl@greenalgeriabase.mrvwbhl.mongodb.net/?appName=greenalgeriabase";

async function test() {
    try {
        const client = new MongoClient(uri);
        await client.connect();
        console.log("Connexion réussie !");
        await client.close();
    } catch (err) {
        console.error("Erreur de connexion :", err);
    }
}

test();
