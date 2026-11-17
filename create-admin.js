require("dotenv").config();

const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}

async function main() {
    const client = new MongoClient(process.env.MONGODB_URI);

    try {
        const name = await ask("Administrator full name: ");
        const email = (await ask("Administrator email: ")).toLowerCase();
        const password = await ask("Administrator password (input will be visible): ");

        if (!name || !email || password.length < 8 || password.length > 72) {
            console.log("Invalid input. Name and email are required; password must be 8–72 characters.");
            return;
        }

        await client.connect();

        const db = client.db(process.env.DB_NAME);
        const users = db.collection("users");

        const existingUser = await users.findOne({ email });

        if (existingUser) {
            console.log("An account with that email already exists. No changes were made.");
            return;
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await users.insertOne({
            name,
            email,
            passwordHash,
            role: "admin",
            createdAt: new Date()
        });

        console.log("Administrator account created successfully.");
        console.log("Account ID:", result.insertedId.toString());
        console.log("Role: admin");
    } catch (error) {
        console.error("Could not create administrator:", error.message);
    } finally {
        rl.close();
        await client.close();
    }
}

main();