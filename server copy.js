
require("dotenv").config();

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const client = new MongoClient(process.env.MONGODB_URI);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function startServer() {
    try {
        await client.connect();

        const db = client.db(process.env.DB_NAME);
        await db.command({ ping: 1 });

        console.log("MongoDB connected successfully!");

        const requests = db.collection("maintenance_requests");

        // Home page
        app.get("/", (req, res) => {
            res.send("Campus Maintenance System is running!");
        });

        // Check database connection
        app.get("/api/health", async (req, res) => {
            try {
                await db.command({ ping: 1 });

                res.json({
                    status: "success",
                    database: process.env.DB_NAME
                });
            } catch (error) {
                res.status(500).json({
                    message: "Database check failed"
                });
            }
        });

        // CREATE: Add a maintenance request
        app.post("/api/requests", async (req, res) => {
            try {
                const {
                    studentId,
                    hostelId,
                    issue,
                    priority
                } = req.body;

                if (
                    typeof studentId !== "string" ||
                    !studentId.trim() ||
                    typeof hostelId !== "string" ||
                    !hostelId.trim() ||
                    typeof issue !== "string" ||
                    !issue.trim()
                ) {
                    return res.status(400).json({
                        message:
                            "Student ID, hostel ID, and issue are required."
                    });
                }

                const allowedPriorities = [
                    "Low",
                    "Medium",
                    "High"
                ];

                const selectedPriority = priority ?? "Medium";

                if (!allowedPriorities.includes(selectedPriority)) {
                    return res.status(400).json({
                        message: "Priority must be Low, Medium, or High."
                    });
                }

                const newRequest = {
                    studentId: studentId.trim(),
                    hostelId: hostelId.trim(),
                    issue: issue.trim(),
                    priority: selectedPriority,
                    status: "Pending",
                    createdAt: new Date()
                };

                const result = await requests.insertOne(newRequest);

                res.status(201).json({
                    message: "Maintenance request created successfully.",
                    request: {
                        _id: result.insertedId,
                        ...newRequest
                    }
                });
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    message: "Failed to create request."
                });
            }
        });

        // READ: Get all maintenance requests
        app.get("/api/requests", async (req, res) => {
            try {
                const allRequests = await requests
                    .find({})
                    .sort({ createdAt: -1 })
                    .toArray();

                res.json(allRequests);
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    message: "Failed to retrieve requests."
                });
            }
        });

        // READ: Get one request by its MongoDB ID
        app.get("/api/requests/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        message: "Invalid request ID."
                    });
                }

                const request = await requests.findOne({
                    _id: new ObjectId(id)
                });

                if (!request) {
                    return res.status(404).json({
                        message: "Request not found."
                    });
                }

                res.json(request);
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    message: "Failed to retrieve request."
                });
            }
        });

        // UPDATE: Edit an existing request
        app.put("/api/requests/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        message: "Invalid request ID."
                    });
                }

                const allowedFields = [
                    "studentId",
                    "hostelId",
                    "issue",
                    "priority",
                    "status"
                ];

                const updates = {};

                for (const field of allowedFields) {
                    if (req.body[field] !== undefined) {
                        updates[field] = req.body[field];
                    }
                }

                if (Object.keys(updates).length === 0) {
                    return res.status(400).json({
                        message: "Provide at least one field to update."
                    });
                }

                for (const field of [
                    "studentId",
                    "hostelId",
                    "issue"
                ]) {
                    if (
                        field in updates &&
                        (typeof updates[field] !== "string" ||
                            !updates[field].trim())
                    ) {
                        return res.status(400).json({
                            message: `${field} must be a non-empty string.`
                        });
                    }

                    if (field in updates) {
                        updates[field] = updates[field].trim();
                    }
                }

                if (
                    "priority" in updates &&
                    !["Low", "Medium", "High"].includes(updates.priority)
                ) {
                    return res.status(400).json({
                        message: "Invalid priority."
                    });
                }

                if (
                    "status" in updates &&
                    !["Pending", "In Progress", "Completed"]
                        .includes(updates.status)
                ) {
                    return res.status(400).json({
                        message: "Invalid status."
                    });
                }

                const result = await requests.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updates }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({
                        message: "Request not found."
                    });
                }

                const updatedRequest = await requests.findOne({
                    _id: new ObjectId(id)
                });

                res.json({
                    message: "Request updated successfully.",
                    request: updatedRequest
                });
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    message: "Failed to update request."
                });
            }
        });

        // DELETE: Remove a maintenance request
        app.delete("/api/requests/:id", async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        message: "Invalid request ID."
                    });
                }

                const result = await requests.deleteOne({
                    _id: new ObjectId(id)
                });

                if (result.deletedCount === 0) {
                    return res.status(404).json({
                        message: "Request not found."
                    });
                }

                res.json({
                    message: "Request deleted successfully."
                });
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    message: "Failed to delete request."
                });
            }
        });

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
            console.log("Maintenance Requests API is ready.");
        });

    } catch (error) {
        console.error("Failed to start application:", error);
        await client.close().catch(() => {});
        process.exitCode = 1;
    }
}

startServer();
