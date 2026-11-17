
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const client = new MongoClient(process.env.MONGODB_URI);

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

async function startServer() {
    try {
        if (!process.env.SESSION_SECRET) {
            throw new Error("SESSION_SECRET is missing from .env");
        }

        await client.connect();

        const db = client.db(process.env.DB_NAME);
        await db.command({ ping: 1 });

        console.log("MongoDB connected successfully!");

        const users = db.collection("users");
        const requests = db.collection("maintenance_requests");

        // Prevent two accounts from using the same email.
        await users.createIndex({ email: 1 }, { unique: true });

        // Store login sessions in MongoDB.
        app.use(
            session({
                name: "campuscare.sid",
                secret: process.env.SESSION_SECRET,
                resave: false,
                saveUninitialized: false,
                store: MongoStore.create({
                    client,
                    dbName: process.env.DB_NAME,
                    collectionName: "sessions",
                    ttl: 14 * 24 * 60 * 60
                }),
                cookie: {
                    httpOnly: true,
                    sameSite: "lax",
                    secure: process.env.NODE_ENV === "production",
                    maxAge: 14 * 24 * 60 * 60 * 1000
                }
            })
        );

        // Return only safe account information.
        function publicUser(user) {
            return {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                ...(user.studentId ? { studentId: user.studentId } : {})
            };
        }

        // Require a logged-in user.
        function requireLogin(req, res, next) {
            if (!req.session.user) {
                return res.status(401).json({
                    message: "Please log in first."
                });
            }

            next();
        }
        
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({
                message: "Please log in first."
            });
        }

        if (!allowedRoles.includes(req.session.user.role)) {
            return res.status(403).json({
                message: "You do not have permission to perform this action."
            });
        }

        next();
    };
}

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
                console.error(error);
                res.status(500).json({
                    message: "Database check failed."
                });
            }
        });

        // AUTH: Register a student account
        app.post("/api/auth/register", async (req, res) => {
            try {
                const { name, email, password, studentId } = req.body;

                if (
                    typeof name !== "string" ||
                    !name.trim() ||
                    typeof email !== "string" ||
                    !email.trim() ||
                    typeof password !== "string"
                ) {
                    return res.status(400).json({
                        message: "Name, email, and password are required."
                    });
                }

                const cleanName = name.trim();
                const cleanEmail = email.trim().toLowerCase();

                if (cleanName.length > 100) {
                    return res.status(400).json({
                        message: "Name must be 100 characters or fewer."
                    });
                }

                if (
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
                    cleanEmail.length > 254
                ) {
                    return res.status(400).json({
                        message: "Enter a valid email address."
                    });
                }

                if (password.length < 8 || password.length > 72) {
                    return res.status(400).json({
                        message: "Password must contain 8–72 characters."
                    });
                }

                let cleanStudentId;

                if (studentId !== undefined && studentId !== "") {
                    if (
                        typeof studentId !== "string" ||
                        studentId.trim().length > 50
                    ) {
                        return res.status(400).json({
                            message: "Student ID must be a valid string."
                        });
                    }

                    cleanStudentId = studentId.trim();
                }

                const existingUser = await users.findOne({
                    email: cleanEmail
                });

                if (existingUser) {
                    return res.status(409).json({
                        message: "An account with this email already exists."
                    });
                }

                const passwordHash = await bcrypt.hash(password, 12);

                const newUser = {
                    name: cleanName,
                    email: cleanEmail,
                    passwordHash,
                    role: "student",
                    createdAt: new Date()
                };

                if (cleanStudentId) {
                    newUser.studentId = cleanStudentId;
                }

                const result = await users.insertOne(newUser);

                res.status(201).json({
                    message: "Student account created successfully. You can now log in.",
                    user: publicUser({
                        ...newUser,
                        _id: result.insertedId
                    })
                });
            } catch (error) {
                if (error.code === 11000) {
                    return res.status(409).json({
                        message: "An account with this email already exists."
                    });
                }

                console.error("Registration error:", error);
                res.status(500).json({
                    message: "Registration failed."
                });
            }
        });

        // AUTH: Log in
        app.post("/api/auth/login", async (req, res) => {
            try {
                const { email, password } = req.body;

                if (
                    typeof email !== "string" ||
                    typeof password !== "string" ||
                    !email.trim() ||
                    !password
                ) {
                    return res.status(400).json({
                        message: "Email and password are required."
                    });
                }

                const cleanEmail = email.trim().toLowerCase();

                const user = await users.findOne({
                    email: cleanEmail
                });

                if (
                    !user ||
                    !(await bcrypt.compare(password, user.passwordHash))
                ) {
                    return res.status(401).json({
                        message: "Invalid email or password."
                    });
                }

                // Regenerate the session ID after login.
                await new Promise((resolve, reject) => {
                    req.session.regenerate((error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });

                req.session.user = {
                    id: user._id.toString(),
                    role: user.role
                };

                await new Promise((resolve, reject) => {
                    req.session.save((error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });

                res.json({
                    message: "Login successful.",
                    user: publicUser(user)
                });
            } catch (error) {
                console.error("Login error:", error);
                res.status(500).json({
                    message: "Login failed."
                });
            }
        });

        // AUTH: Check the current login
        app.get("/api/auth/me", requireLogin, async (req, res) => {
            try {
                const user = await users.findOne({
                    _id: new ObjectId(req.session.user.id)
                });

                if (!user) {
                    req.session.destroy(() => {});
                    return res.status(401).json({
                        message: "Account not found. Please log in again."
                    });
                }

                res.json({ user: publicUser(user) });
            } catch (error) {
                console.error("Session check error:", error);
                res.status(500).json({
                    message: "Could not check your login."
                });
            }
        });

        // AUTH: Log out
        app.post("/api/auth/logout", requireLogin, (req, res) => {
            req.session.destroy((error) => {
                if (error) {
                    console.error("Logout error:", error);
                    return res.status(500).json({
                        message: "Logout failed."
                    });
                }

                res.clearCookie("campuscare.sid", {
                    httpOnly: true,
                    sameSite: "lax",
                    secure: process.env.NODE_ENV === "production"
                });

                res.json({ message: "Logout successful." });
            });
        });

        
        // CREATE: Students submit their own requests.
        // Administrators may also create requests.
        app.post(
            "/api/requests",
            requireRole("student", "admin"),
            async (req, res) => {
                try {
                    const {
                        studentId,
                        hostelId,
                        issue,
                        priority
                    } = req.body;

                    if (
                        typeof hostelId !== "string" ||
                        !hostelId.trim() ||
                        typeof issue !== "string" ||
                        !issue.trim()
                    ) {
                        return res.status(400).json({
                            message: "Hostel ID and issue are required."
                        });
                    }

                    let requestStudentId;

                    if (req.session.user.role === "student") {
                        const user = await users.findOne({
                            _id: new ObjectId(req.session.user.id)
                        });

                        if (!user || !user.studentId) {
                            return res.status(400).json({
                                message: "Your account needs a student ID. Contact the administrator."
                            });
                        }

                        // Never trust a student ID supplied by the browser.
                        requestStudentId = user.studentId;
                    } else {
                        if (
                            typeof studentId !== "string" ||
                            !studentId.trim()
                        ) {
                            return res.status(400).json({
                                message: "Student ID is required when an administrator creates a request."
                            });
                        }

                        requestStudentId = studentId.trim();
                    }

                    const selectedPriority = priority ?? "Medium";

                    if (
                        !["Low", "Medium", "High"].includes(
                            selectedPriority
                        )
                    ) {
                        return res.status(400).json({
                            message: "Priority must be Low, Medium, or High."
                        });
                    }

                    const newRequest = {
                        studentId: requestStudentId,
                        hostelId: hostelId.trim(),
                        issue: issue.trim(),
                        priority: selectedPriority,
                        status: "Pending",
                        createdBy: req.session.user.id,
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
                    console.error("Create request error:", error);
                    res.status(500).json({
                        message: "Failed to create request."
                    });
                }
            }
        );

        // READ: Students see their own requests.
        // Staff and administrators see all requests.
        app.get(
            "/api/requests",
            requireLogin,
            async (req, res) => {
                try {
                    const filter =
                        req.session.user.role === "student"
                            ? { createdBy: req.session.user.id }
                            : {};

                    const allRequests = await requests
                        .find(filter)
                        .sort({ createdAt: -1 })
                        .toArray();

                    res.json(allRequests);
                } catch (error) {
                    console.error("Read requests error:", error);
                    res.status(500).json({
                        message: "Failed to retrieve requests."
                    });
                }
            }
        );

        // READ: Get one request, subject to role and ownership.
        app.get(
            "/api/requests/:id",
            requireLogin,
            async (req, res) => {
                try {
                    const { id } = req.params;

                    if (!ObjectId.isValid(id)) {
                        return res.status(400).json({
                            message: "Invalid request ID."
                        });
                    }

                    const filter = {
                        _id: new ObjectId(id)
                    };

                    if (req.session.user.role === "student") {
                        filter.createdBy = req.session.user.id;
                    }

                    const request = await requests.findOne(filter);

                    if (!request) {
                        return res.status(404).json({
                            message: "Request not found."
                        });
                    }

                    res.json(request);
                } catch (error) {
                    console.error("Read one request error:", error);
                    res.status(500).json({
                        message: "Failed to retrieve request."
                    });
                }
            }
        );

        // UPDATE: Staff may update status only.
        // Administrators may update request fields.
        app.put(
            "/api/requests/:id",
            requireRole("maintenance_staff", "admin"),
            async (req, res) => {
                try {
                    const { id } = req.params;

                    if (!ObjectId.isValid(id)) {
                        return res.status(400).json({
                            message: "Invalid request ID."
                        });
                    }

                    const updates = {};

                    if (req.session.user.role === "maintenance_staff") {
                        if (
                            typeof req.body.status !== "string" ||
                            !["Pending", "In Progress", "Completed"]
                                .includes(req.body.status)
                        ) {
                            return res.status(400).json({
                                message: "Staff must provide a valid status."
                            });
                        }

                        updates.status = req.body.status;
                    } else {
                        const allowedFields = [
                            "studentId",
                            "hostelId",
                            "issue",
                            "priority",
                            "status"
                        ];

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
                            if (field in updates) {
                                if (
                                    typeof updates[field] !== "string" ||
                                    !updates[field].trim()
                                ) {
                                    return res.status(400).json({
                                        message: `${field} must be a non-empty string.`
                                    });
                                }

                                updates[field] = updates[field].trim();
                            }
                        }

                        if (
                            "priority" in updates &&
                            !["Low", "Medium", "High"]
                                .includes(updates.priority)
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
                    console.error("Update request error:", error);
                    res.status(500).json({
                        message: "Failed to update request."
                    });
                }
            }
        );

        // DELETE: Administrators only.
        app.delete(
            "/api/requests/:id",
            requireRole("admin"),
            async (req, res) => {
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
                    console.error("Delete request error:", error);
                    res.status(500).json({
                        message: "Failed to delete request."
                    });
                }
            }
        );


        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
            console.log("CampusCare authentication and API are ready.");
        });
    } catch (error) {
        console.error("Failed to start application:", error);
        await client.close().catch(() => {});
        process.exitCode = 1;
    }
}

startServer();
