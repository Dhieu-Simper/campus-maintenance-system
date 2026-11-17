
"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

const app = express();

// Trust Render's reverse proxy so secure session cookies work over HTTPS.
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
}

const client = new MongoClient(process.env.MONGODB_URI);

const UPLOAD_DIR = path.join(__dirname, "uploads");
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: "20kb" }));

const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(null, UPLOAD_DIR);
    },
    filename: (req, file, callback) => {
        const extension = ALLOWED_PHOTO_TYPES[file.mimetype];

        if (!extension) {
            return callback(
                new Error("Only JPG, PNG, and WebP images are allowed.")
            );
        }

        callback(null, `${crypto.randomUUID()}${extension}`);
    }
});

const uploadIssuePhoto = multer({
    storage,
    limits: {
        fileSize: MAX_PHOTO_SIZE,
        files: 1
    },
    fileFilter: (req, file, callback) => {
        if (!ALLOWED_PHOTO_TYPES[file.mimetype]) {
            return callback(
                new Error("Only JPG, PNG, and WebP images are allowed.")
            );
        }

        callback(null, true);
    }
});

function removeFile(filename) {
    if (!filename || path.basename(filename) !== filename) {
        return;
    }

    const filePath = path.join(UPLOAD_DIR, filename);

    fs.unlink(filePath, error => {
        if (error && error.code !== "ENOENT") {
            console.error("Could not remove uploaded photo:", error);
        }
    });
}

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

        await users.createIndex({ email: 1 }, { unique: true });

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

        app.use(express.static(path.join(__dirname, "public")));

        function publicUser(user) {
            return {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                ...(user.studentId ? { studentId: user.studentId } : {}),
                ...(user.specialization
                    ? { specialization: user.specialization }
                    : {})
            };
        }

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

        function addPhotoUrl(request) {
            if (!request) return request;

            const result = { ...request };

            if (result.photoFilename) {
                result.imageUrl =
                    `/api/request-images/${encodeURIComponent(result.photoFilename)}`;
            }

            // Do not expose internal storage filenames to the frontend.
            delete result.photoFilename;

            return result;
        }

        const validStatuses = [
            "Pending",
            "In Progress",
            "Completed"
        ];

        const validPriorities = ["Low", "Medium", "High"];

        const validSpecializations = [
            "Plumbing",
            "Electrical",
            "Carpentry and Repairs",
            "Building and Civil Works",
            "ICT and Networking",
            "Painting",
            "Cleaning and Sanitation",
            "HVAC",
            "General Maintenance"
        ];

        // HEALTH CHECK
        app.get("/api/health", async (req, res) => {
            try {
                await db.command({ ping: 1 });

                res.json({
                    status: "success",
                    database: process.env.DB_NAME
                });
            } catch (error) {
                console.error("Health check error:", error);

                res.status(500).json({
                    message: "Database check failed."
                });
            }
        });

        // REGISTER: STUDENT ACCOUNTS ONLY
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

        // CREATE TECHNICIAN: ADMIN ONLY
        app.post(
            "/api/technicians",
            requireRole("admin"),
            async (req, res) => {
                try {
                    const {
                        name,
                        email,
                        password,
                        specialization
                    } = req.body;

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

                    if (
                        typeof specialization !== "string" ||
                        !validSpecializations.includes(specialization)
                    ) {
                        return res.status(400).json({
                            message: "Please select a valid technician specialization."
                        });
                    }

                    const passwordHash = await bcrypt.hash(password, 12);

                    const technician = {
                        name: cleanName,
                        email: cleanEmail,
                        passwordHash,
                        role: "maintenance_staff",
                        specialization,
                        createdAt: new Date()
                    };

                    const result = await users.insertOne(technician);

                    res.status(201).json({
                        message: "Technician account created successfully.",
                        technician: publicUser({
                            ...technician,
                            _id: result.insertedId
                        })
                    });
                } catch (error) {
                    if (error.code === 11000) {
                        return res.status(409).json({
                            message: "An account with this email already exists."
                        });
                    }

                    console.error("Create technician error:", error);

                    res.status(500).json({
                        message: "Failed to create technician account."
                    });
                }
            }
        );

        
        // LIST STUDENTS: ADMIN ONLY
        app.get(
            "/api/students",
            requireRole("admin"),
            async (req, res) => {
                try {
                    const students = await users
                        .find(
                            { role: "student" },
                            { projection: { passwordHash: 0 } }
                        )
                        .sort({ name: 1 })
                        .toArray();

                    res.json(students.map(publicUser));
                } catch (error) {
                    console.error("List students error:", error);

                    res.status(500).json({
                        message: "Failed to retrieve students."
                    });
                }
            }
        );

        // LIST TECHNICIANS: ADMIN ONLY
        app.get(
            "/api/technicians",
            requireRole("admin"),
            async (req, res) => {
                try {
                    const technicians = await users
                        .find(
                            { role: "maintenance_staff" },
                            { projection: { passwordHash: 0 } }
                        )
                        .sort({ name: 1 })
                        .toArray();

                    res.json(technicians.map(publicUser));
                } catch (error) {
                    console.error("List technicians error:", error);

                    res.status(500).json({
                        message: "Failed to retrieve technicians."
                    });
                }
            }
        );



        // LIST TECHNICIANS: ADMIN ONLY
        app.get(
            "/api/technicians",
            requireRole("admin"),
            async (req, res) => {
                try {
                    const technicians = await users
                        .find(
                            { role: "maintenance_staff" },
                            { projection: { passwordHash: 0 } }
                        )
                        .sort({ name: 1 })
                        .toArray();

                    res.json(technicians.map(publicUser));
                } catch (error) {
                    console.error("List technicians error:", error);

                    res.status(500).json({
                        message: "Failed to retrieve technicians."
                    });
                }
            }
        );

        // LOGIN
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

                const user = await users.findOne({
                    email: email.trim().toLowerCase()
                });

                if (
                    !user ||
                    !(await bcrypt.compare(password, user.passwordHash))
                ) {
                    return res.status(401).json({
                        message: "Invalid email or password."
                    });
                }

                await new Promise((resolve, reject) => {
                    req.session.regenerate(error => {
                        if (error) reject(error);
                        else resolve();
                    });
                });

                req.session.user = {
                    id: user._id.toString(),
                    role: user.role
                };

                await new Promise((resolve, reject) => {
                    req.session.save(error => {
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

        // CHECK CURRENT SESSION
        app.get("/api/auth/me", requireLogin, async (req, res) => {
            try {
                if (!ObjectId.isValid(req.session.user.id)) {
                    return res.status(401).json({
                        message: "Invalid session. Please log in again."
                    });
                }

                const user = await users.findOne({
                    _id: new ObjectId(req.session.user.id)
                });

                if (!user) {
                    return req.session.destroy(() => {
                        res.status(401).json({
                            message: "Account not found. Please log in again."
                        });
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

        // LOGOUT
        app.post("/api/auth/logout", requireLogin, (req, res) => {
            req.session.destroy(error => {
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

        // CREATE MAINTENANCE REQUEST, WITH OPTIONAL PHOTO
        app.post(
            "/api/requests",
            requireRole("student", "admin"),
            uploadIssuePhoto.single("issuePhoto"),
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
                        hostelId.trim().length > 100 ||
                        typeof issue !== "string" ||
                        !issue.trim() ||
                        issue.trim().length > 5000
                    ) {
                        if (req.file) removeFile(req.file.filename);

                        return res.status(400).json({
                            message: "Enter a valid hostel ID and issue description."
                        });
                    }

                    let requestStudentId;

                    if (req.session.user.role === "student") {
                        const user = await users.findOne({
                            _id: new ObjectId(req.session.user.id)
                        });

                        if (!user || !user.studentId) {
                            if (req.file) removeFile(req.file.filename);

                            return res.status(400).json({
                                message: "Your account needs a student ID. Contact the administrator."
                            });
                        }

                        requestStudentId = user.studentId;
                    } else {
                        if (
                            typeof studentId !== "string" ||
                            !studentId.trim() ||
                            studentId.trim().length > 50
                        ) {
                            if (req.file) removeFile(req.file.filename);

                            return res.status(400).json({
                                message: "A valid student ID is required."
                            });
                        }

                        requestStudentId = studentId.trim();
                    }

                    const selectedPriority = priority || "Medium";

                    if (!validPriorities.includes(selectedPriority)) {
                        if (req.file) removeFile(req.file.filename);

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
                        assignedTo: null,
                        assignedAt: null,
                        createdAt: new Date()
                    };

                    if (req.file) {
                        newRequest.photoFilename = req.file.filename;
                    }

                    const result = await requests.insertOne(newRequest);

                    res.status(201).json({
                        message: "Maintenance request created successfully.",
                        request: addPhotoUrl({
                            _id: result.insertedId,
                            ...newRequest
                        })
                    });
                } catch (error) {
                    if (req.file) removeFile(req.file.filename);

                    console.error("Create request error:", error);

                    res.status(500).json({
                        message: "Failed to create request."
                    });
                }
            }
        );

        // LIST REQUESTS
        app.get("/api/requests", requireLogin, async (req, res) => {
            try {
                const role = req.session.user.role;
                let filter = {};

                if (role === "student") {
                    filter = { createdBy: req.session.user.id };
                } else if (role === "maintenance_staff") {
                    filter = { assignedTo: req.session.user.id };
                } else if (role !== "admin") {
                    return res.status(403).json({
                        message: "Your account role is not permitted."
                    });
                }

                const allRequests = await requests
                    .find(filter)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.json(allRequests.map(addPhotoUrl));
            } catch (error) {
                console.error("Read requests error:", error);

                res.status(500).json({
                    message: "Failed to retrieve requests."
                });
            }
        });

        // GET ONE REQUEST
        app.get("/api/requests/:id", requireLogin, async (req, res) => {
            try {
                const { id } = req.params;

                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({
                        message: "Invalid request ID."
                    });
                }

                const role = req.session.user.role;
                const filter = { _id: new ObjectId(id) };

                if (role === "student") {
                    filter.createdBy = req.session.user.id;
                } else if (role === "maintenance_staff") {
                    filter.assignedTo = req.session.user.id;
                } else if (role !== "admin") {
                    return res.status(403).json({
                        message: "Your account role is not permitted."
                    });
                }

                const request = await requests.findOne(filter);

                if (!request) {
                    return res.status(404).json({
                        message: "Request not found."
                    });
                }

                res.json(addPhotoUrl(request));
            } catch (error) {
                console.error("Read one request error:", error);

                res.status(500).json({
                    message: "Failed to retrieve request."
                });
            }
        });

        // VIEW PHOTO: REQUEST OWNER, ASSIGNED TECHNICIAN, OR ADMIN
        app.get(
            "/api/request-images/:filename",
            requireLogin,
            async (req, res) => {
                try {
                    const filename = req.params.filename;

                    if (
                        typeof filename !== "string" ||
                        path.basename(filename) !== filename ||
                        !/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(filename)
                    ) {
                        return res.status(400).json({
                            message: "Invalid photo filename."
                        });
                    }

                    const request = await requests.findOne({
                        photoFilename: filename
                    });

                    if (!request) {
                        return res.status(404).json({
                            message: "Photo not found."
                        });
                    }

                    const user = req.session.user;
                    const isAllowed =
                        user.role === "admin" ||
                        (
                            user.role === "student" &&
                            request.createdBy === user.id
                        ) ||
                        (
                            user.role === "maintenance_staff" &&
                            request.assignedTo === user.id
                        );

                    if (!isAllowed) {
                        return res.status(403).json({
                            message: "You do not have permission to view this photo."
                        });
                    }

                    const extension = path.extname(filename).toLowerCase();
                    const contentTypes = {
                        ".jpg": "image/jpeg",
                        ".png": "image/png",
                        ".webp": "image/webp"
                    };

                    res.setHeader(
                        "Content-Type",
                        contentTypes[extension]
                    );
                    res.setHeader("X-Content-Type-Options", "nosniff");
                    res.setHeader("Cache-Control", "private, no-store");

                    res.sendFile(
                        path.join(UPLOAD_DIR, filename),
                        error => {
                            if (error && !res.headersSent) {
                                res.status(error.statusCode || 404).json({
                                    message: "Photo file could not be found."
                                });
                            }
                        }
                    );
                } catch (error) {
                    console.error("View photo error:", error);

                    if (!res.headersSent) {
                        res.status(500).json({
                            message: "Could not retrieve photo."
                        });
                    }
                }
            }
        );

        // ASSIGN OR REASSIGN REQUEST: ADMIN ONLY
        app.put(
            "/api/requests/:id/assign",
            requireRole("admin"),
            async (req, res) => {
                try {
                    const { id } = req.params;
                    const { technicianId } = req.body;

                    if (!ObjectId.isValid(id)) {
                        return res.status(400).json({
                            message: "Invalid request ID."
                        });
                    }

                    if (
                        typeof technicianId !== "string" ||
                        !ObjectId.isValid(technicianId)
                    ) {
                        return res.status(400).json({
                            message: "Select a valid technician."
                        });
                    }

                    const technician = await users.findOne({
                        _id: new ObjectId(technicianId),
                        role: "maintenance_staff"
                    });

                    if (!technician) {
                        return res.status(404).json({
                            message: "Technician account not found."
                        });
                    }

                    const result = await requests.updateOne(
                        { _id: new ObjectId(id) },
                        {
                            $set: {
                                assignedTo: technician._id.toString(),
                                assignedAt: new Date()
                            }
                        }
                    );

                    if (result.matchedCount === 0) {
                        return res.status(404).json({
                            message: "Maintenance request not found."
                        });
                    }

                    const updatedRequest = await requests.findOne({
                        _id: new ObjectId(id)
                    });

                    res.json({
                        message: `Job assigned to ${technician.name} successfully.`,
                        request: addPhotoUrl(updatedRequest)
                    });
                } catch (error) {
                    console.error("Assign request error:", error);

                    res.status(500).json({
                        message: "Failed to assign maintenance request."
                    });
                }
            }
        );

        // UPDATE REQUEST
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

                    const role = req.session.user.role;
                    const updates = {};

                    if (role === "maintenance_staff") {
                        if (
                            typeof req.body.status !== "string" ||
                            !validStatuses.includes(req.body.status)
                        ) {
                            return res.status(400).json({
                                message: "Provide a valid status."
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
                            "studentId" in updates &&
                            updates.studentId.length > 50
                        ) {
                            return res.status(400).json({
                                message: "Student ID is too long."
                            });
                        }

                        if (
                            "hostelId" in updates &&
                            updates.hostelId.length > 100
                        ) {
                            return res.status(400).json({
                                message: "Hostel ID is too long."
                            });
                        }

                        if (
                            "issue" in updates &&
                            updates.issue.length > 5000
                        ) {
                            return res.status(400).json({
                                message: "Issue description is too long."
                            });
                        }

                        if (
                            "priority" in updates &&
                            !validPriorities.includes(updates.priority)
                        ) {
                            return res.status(400).json({
                                message: "Invalid priority."
                            });
                        }

                        if (
                            "status" in updates &&
                            !validStatuses.includes(updates.status)
                        ) {
                            return res.status(400).json({
                                message: "Invalid status."
                            });
                        }
                    }

                    const updateFilter = {
                        _id: new ObjectId(id)
                    };

                    if (role === "maintenance_staff") {
                        updateFilter.assignedTo = req.session.user.id;
                    }

                    const result = await requests.updateOne(
                        updateFilter,
                        { $set: updates }
                    );

                    if (result.matchedCount === 0) {
                        return res.status(404).json({
                            message: "Request not found or not assigned to you."
                        });
                    }

                    const updatedRequest = await requests.findOne({
                        _id: new ObjectId(id)
                    });

                    res.json({
                        message: "Request updated successfully.",
                        request: addPhotoUrl(updatedRequest)
                    });
                } catch (error) {
                    console.error("Update request error:", error);

                    res.status(500).json({
                        message: "Failed to update request."
                    });
                }
            }
        );

        // DELETE REQUEST: ADMIN ONLY
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

                    const existingRequest = await requests.findOne({
                        _id: new ObjectId(id)
                    });

                    if (!existingRequest) {
                        return res.status(404).json({
                            message: "Request not found."
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

                    if (existingRequest.photoFilename) {
                        removeFile(existingRequest.photoFilename);
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

        // HANDLE MULTER AND OTHER MIDDLEWARE ERRORS
        app.use((error, req, res, next) => {
            if (res.headersSent) {
                return next(error);
            }

            if (error instanceof multer.MulterError) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({
                        message: "The photo must not exceed 5 MB."
                    });
                }

                if (error.code === "LIMIT_FILE_COUNT") {
                    return res.status(400).json({
                        message: "Only one photo can be uploaded per request."
                    });
                }

                return res.status(400).json({
                    message: error.message || "Photo upload failed."
                });
            }

            if (
                error.message ===
                "Only JPG, PNG, and WebP images are allowed."
            ) {
                return res.status(400).json({
                    message: error.message
                });
            }

            console.error("Unhandled server error:", error);

            res.status(500).json({
                message: "An unexpected server error occurred."
            });
        });

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
            console.log("CampusCare authentication, API, and photo uploads are ready.");
        });
    } catch (error) {
        console.error("Failed to start application:", error);

        await client.close().catch(() => {});
        process.exitCode = 1;
    }
}

startServer();
