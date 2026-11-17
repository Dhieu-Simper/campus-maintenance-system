
"use strict";

const AUTH_URL = "/api/auth";
const API_URL = "/api/requests";
const TECHNICIANS_URL = "/api/technicians";
const STUDENTS_URL = "/api/students";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

const authSection = document.getElementById("authSection");
const appSection = document.getElementById("appSection");
const userBar = document.getElementById("userBar");
const currentUser = document.getElementById("currentUser");
const logoutButton = document.getElementById("logoutButton");

const authMode = document.getElementById("authMode");
const authForm = document.getElementById("authForm");
const authName = document.getElementById("authName");
const authStudentId = document.getElementById("authStudentId");
const nameLabel = document.getElementById("nameLabel");
const studentIdLabel = document.getElementById("studentIdLabel");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmit = document.getElementById("authSubmit");
const authMessage = document.getElementById("authMessage");

const requestForm = document.getElementById("requestForm");
const requestSection = document.getElementById("newRequestSection");
const studentIdGroup = document.getElementById("studentIdGroup");
const studentIdInput = document.getElementById("studentId");
const hostelIdInput = document.getElementById("hostelId");
const issueInput = document.getElementById("issue");
const priorityInput = document.getElementById("priority");
const formMessage = document.getElementById("formMessage");

const issuePhotoInput = document.getElementById("issuePhoto");
const issuePhotoPreview = document.getElementById("issuePhotoPreview");
const issuePhotoPreviewContainer =
    document.getElementById("issuePhotoPreviewContainer");
const removeIssuePhotoButton =
    document.getElementById("removeIssuePhoto");
const issuePhotoMessage = document.getElementById("issuePhotoMessage");

const requestsTableBody = document.getElementById("requestsTableBody");
const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const priorityFilter = document.getElementById("priorityFilter");
const resetFilters = document.getElementById("resetFilters");
const resultsCount = document.getElementById("resultsCount");
const actionsHeading = document.getElementById("actionsHeading");

const technicianManagementSection =
    document.getElementById("technicianManagementSection");
const technicianForm = document.getElementById("technicianForm");
const technicianName = document.getElementById("technicianName");
const technicianEmail = document.getElementById("technicianEmail");
const technicianPassword = document.getElementById("technicianPassword");
const technicianSpecialization =
    document.getElementById("technicianSpecialization");
const technicianMessage = document.getElementById("technicianMessage");

// Student management elements
const studentManagementSection =
    document.getElementById("studentManagementSection");
const studentsTableBody =
    document.getElementById("studentsTableBody");
const studentsMessage =
    document.getElementById("studentsMessage");
const refreshStudentsButton =
    document.getElementById("refreshStudentsButton");

let allRequests = [];
let allTechnicians = [];
let allStudents = [];
let currentUserData = null;
let photoPreviewUrl = null;

async function apiRequest(url, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (
        options.body &&
        !(options.body instanceof FormData) &&
        !headers["Content-Type"] &&
        !headers["content-type"]
    ) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            result.message || `Request failed (${response.status}).`
        );
    }

    return result;
}

function showAuthMessage(message, isError = false) {
    authMessage.textContent = message;
    authMessage.style.color = isError ? "#c0392b" : "#16804a";
}

function showMessage(message, isError = false) {
    const requestActionMessage =
        document.getElementById("requestActionMessage");

    const target = currentUserData?.role === "admin"
        ? requestActionMessage || formMessage
        : currentUserData?.role === "maintenance_staff"
            ? requestActionMessage || formMessage
            : formMessage;

    if (!target) return;

    target.textContent = message;
    target.style.color = isError ? "#c0392b" : "#16804a";
}

function showTechnicianMessage(message, isError = false) {
    if (!technicianMessage) return;

    technicianMessage.textContent = message;
    technicianMessage.style.color = isError ? "#c0392b" : "#16804a";
}

function showPhotoMessage(message, isError = false) {
    if (!issuePhotoMessage) return;

    issuePhotoMessage.textContent = message;
    issuePhotoMessage.style.color = isError ? "#c0392b" : "#16804a";
}

function clearPhotoPreview() {
    if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
        photoPreviewUrl = null;
    }

    if (issuePhotoInput) issuePhotoInput.value = "";
    if (issuePhotoPreview) issuePhotoPreview.removeAttribute("src");

    if (issuePhotoPreviewContainer) {
        issuePhotoPreviewContainer.hidden = true;
    }

    showPhotoMessage("");
}

function updatePhotoPreview() {
    const file = issuePhotoInput?.files?.[0];

    if (!file) {
        clearPhotoPreview();
        return;
    }

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        clearPhotoPreview();
        showPhotoMessage("Choose a JPG, PNG, or WebP image.", true);
        return;
    }

    if (file.size > MAX_PHOTO_SIZE) {
        clearPhotoPreview();
        showPhotoMessage(
            "The image is too large. Choose an image no larger than 5 MB.",
            true
        );
        return;
    }

    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);

    photoPreviewUrl = URL.createObjectURL(file);
    issuePhotoPreview.src = photoPreviewUrl;
    issuePhotoPreviewContainer.hidden = false;

    showPhotoMessage(`Selected: ${file.name}`);
}

if (issuePhotoInput) {
    issuePhotoInput.addEventListener("change", updatePhotoPreview);
}

if (removeIssuePhotoButton) {
    removeIssuePhotoButton.addEventListener("click", clearPhotoPreview);
}

function updateAuthForm() {
    const registering = authMode.value === "register";

    authName.hidden = !registering;
    nameLabel.hidden = !registering;
    authStudentId.hidden = !registering;
    studentIdLabel.hidden = !registering;

    authName.required = registering;
    authStudentId.required = registering;

    authPassword.autocomplete = registering
        ? "new-password"
        : "current-password";

    authSubmit.textContent = registering
        ? "Create Student Account"
        : "Log in";

    authPassword.value = "";
    showAuthMessage("");
}

function updateDashboard(requests) {
    const pending = requests.filter(
        request => request.status === "Pending"
    ).length;

    const inProgress = requests.filter(
        request => request.status === "In Progress"
    ).length;

    const completed = requests.filter(
        request => request.status === "Completed"
    ).length;

    document.getElementById("totalRequests").textContent =
        currentUserData?.role === "maintenance_staff"
            ? pending + inProgress
            : requests.length;

    document.getElementById("pendingRequests").textContent = pending;
    document.getElementById("inProgressRequests").textContent = inProgress;
    document.getElementById("completedRequests").textContent = completed;
}

function createCell(value) {
    const cell = document.createElement("td");

    cell.textContent =
        value == null || value === "" ? "—" : String(value);

    return cell;
}

function createPhotoCell(request) {
    const cell = document.createElement("td");
    const imageUrl = request.imageUrl;

    if (!imageUrl) {
        cell.textContent = "No photo";
        return cell;
    }

    const link = document.createElement("a");
    link.href = imageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View photo";
    link.style.display = "inline-block";

    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "Maintenance issue";
    image.loading = "lazy";
    image.style.width = "90px";
    image.style.height = "70px";
    image.style.objectFit = "cover";
    image.style.display = "block";
    image.style.borderRadius = "6px";
    image.style.marginBottom = "5px";

    image.addEventListener("error", () => {
        image.hidden = true;
        link.textContent = "Photo unavailable";
    });

    link.prepend(image);
    cell.appendChild(link);

    return cell;
}

function createButton(text, className, handler) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("click", handler);

    return button;
}

function getTechnicianName(technicianId) {
    if (!technicianId) return "Not assigned";

    const technician = allTechnicians.find(
        item => String(item._id || item.id) === String(technicianId)
    );

    return technician ? technician.name : "Assigned";
}

function createStatusSelect(request) {
    const select = document.createElement("select");

    select.className = "status-select";
    select.setAttribute("aria-label", "Request status");

    ["Pending", "In Progress", "Completed"].forEach(status => {
        const option = document.createElement("option");

        option.value = status;
        option.textContent = status;
        option.selected = request.status === status;

        select.appendChild(option);
    });

    return select;
}

function createAssignmentControls(request) {
    const container = document.createElement("div");
    container.className = "assignment-controls";

    const select = document.createElement("select");
    select.className = "status-select";
    select.setAttribute("aria-label", "Assign technician");

    const unassignedOption = document.createElement("option");
    unassignedOption.value = "";
    unassignedOption.textContent = "Select technician";
    select.appendChild(unassignedOption);

    allTechnicians.forEach(technician => {
        const option = document.createElement("option");

        option.value = technician._id || technician.id;
        option.textContent = technician.name;

        if (
            request.assignedTo &&
            String(request.assignedTo) === String(option.value)
        ) {
            option.selected = true;
        }

        select.appendChild(option);
    });

    const assignButton = createButton(
        "Assign",
        "btn-update",
        async () => {
            if (!select.value) {
                showMessage("Please select a technician first.", true);
                return;
            }

            assignButton.disabled = true;

            try {
                await apiRequest(`${API_URL}/${request._id}/assign`, {
                    method: "PUT",
                    body: JSON.stringify({
                        technicianId: select.value
                    })
                });

                showMessage("Technician assigned successfully!");
                await loadRequests();
            } catch (error) {
                showMessage(error.message, true);
            } finally {
                assignButton.disabled = false;
            }
        }
    );

    container.appendChild(select);
    container.appendChild(assignButton);

    return container;
}

function filterRequests() {
    const searchTerm = searchInput.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value;
    const selectedPriority = priorityFilter.value;

    const filteredRequests = allRequests.filter(request => {
        const searchableText = [
            request.studentId,
            request.hostelId,
            request.issue,
            request.status,
            getTechnicianName(request.assignedTo)
        ].join(" ").toLowerCase();

        return (
            searchableText.includes(searchTerm) &&
            (selectedStatus === "All" ||
                request.status === selectedStatus) &&
            (selectedPriority === "All" ||
                request.priority === selectedPriority)
        );
    });

    displayRequests(filteredRequests);
}

function displayRequests(requests) {
    requestsTableBody.replaceChildren();

    resultsCount.textContent =
        `Showing ${requests.length} of ${allRequests.length} requests`;

    if (requests.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 9;
        cell.textContent = allRequests.length === 0
            ? currentUserData.role === "maintenance_staff"
                ? "No jobs have been assigned to you yet."
                : "No maintenance requests have been reported yet."
            : "No requests match your search or filters.";

        row.appendChild(cell);
        requestsTableBody.appendChild(row);
        return;
    }

    const role = currentUserData.role;
    const isAdmin = role === "admin";
    const isTechnician = role === "maintenance_staff";
    const canUpdate = isAdmin || isTechnician;
    const canDelete = isAdmin;

    requests.forEach(request => {
        const row = document.createElement("tr");

        row.appendChild(createCell(request.studentId));
        row.appendChild(createCell(request.hostelId));
        row.appendChild(createCell(request.issue));
        row.appendChild(createPhotoCell(request));
        row.appendChild(createCell(request.priority));

        const statusCell = document.createElement("td");

        if (canUpdate) {
            const statusSelect = createStatusSelect(request);

            const updateButton = createButton(
                isTechnician ? "Save Status" : "Update Status",
                "btn-update",
                async event => {
                    await updateRequestStatus(
                        request._id,
                        statusSelect.value,
                        event.currentTarget
                    );
                }
            );

            statusCell.appendChild(statusSelect);
            statusCell.appendChild(updateButton);
        } else {
            statusCell.textContent = request.status || "Pending";
        }

        row.appendChild(statusCell);

        row.appendChild(createCell(
            request.createdAt
                ? new Date(request.createdAt).toLocaleString()
                : "Not available"
        ));

        const assignedCell = document.createElement("td");

        if (isAdmin) {
            assignedCell.appendChild(createAssignmentControls(request));
        } else {
            assignedCell.textContent = getTechnicianName(request.assignedTo);
        }

        row.appendChild(assignedCell);

        const actionCell = document.createElement("td");

        if (canDelete) {
            actionCell.appendChild(createButton(
                "Delete",
                "btn-delete",
                async event => {
                    await deleteRequest(request._id, event.currentTarget);
                }
            ));
        } else if (role === "student") {
            actionCell.textContent = "View only";
        } else {
            actionCell.textContent = "Assigned job";
        }

        row.appendChild(actionCell);
        requestsTableBody.appendChild(row);
    });
}

async function loadRequests() {
    try {
        const requests = await apiRequest(API_URL);

        allRequests = Array.isArray(requests) ? requests : [];

        updateDashboard(allRequests);
        filterRequests();
    } catch (error) {
        console.error("Error loading requests:", error);

        resultsCount.textContent = "Unable to load requests.";
        requestsTableBody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 9;
        cell.textContent = error.message;

        row.appendChild(cell);
        requestsTableBody.appendChild(row);
    }
}

async function loadTechnicians() {
    if (currentUserData?.role !== "admin") return;

    try {
        const technicians = await apiRequest(TECHNICIANS_URL);

        allTechnicians = Array.isArray(technicians)
            ? technicians
            : [];
    } catch (error) {
        allTechnicians = [];
        console.error("Could not load technicians:", error);

        showMessage(
            "Could not load technicians. Check your admin permissions.",
            true
        );
    }
}

// STUDENT MANAGEMENT
function displayStudents(students) {
    if (!studentsTableBody) return;

    studentsTableBody.replaceChildren();

    if (!students.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 4;
        cell.textContent = "No registered students found.";

        row.appendChild(cell);
        studentsTableBody.appendChild(row);
        return;
    }

    students.forEach(student => {
        const row = document.createElement("tr");

        row.appendChild(createCell(student.studentId));
        row.appendChild(createCell(student.name));
        row.appendChild(createCell(student.email));

        row.appendChild(createCell(
            student.createdAt
                ? new Date(student.createdAt).toLocaleDateString()
                : "Not available"
        ));

        studentsTableBody.appendChild(row);
    });
}

async function loadStudents() {
    if (currentUserData?.role !== "admin") return;

    if (!studentsTableBody || !studentsMessage) {
        console.error(
            "Student management HTML section is missing from index.html."
        );
        return;
    }

    studentsMessage.textContent = "Loading students...";

    if (refreshStudentsButton) {
        refreshStudentsButton.disabled = true;
    }

    try {
        const students = await apiRequest(STUDENTS_URL);

        allStudents = Array.isArray(students) ? students : [];

        displayStudents(allStudents);

        studentsMessage.textContent =
            `Total registered students: ${allStudents.length}`;
    } catch (error) {
        console.error("Could not load students:", error);

        studentsMessage.textContent =
            `Could not load students: ${error.message}`;

        studentsTableBody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 4;
        cell.textContent = error.message;

        row.appendChild(cell);
        studentsTableBody.appendChild(row);
    } finally {
        if (refreshStudentsButton) {
            refreshStudentsButton.disabled = false;
        }
    }
}

async function loadDashboardData() {
    if (currentUserData?.role === "admin") {
        await loadTechnicians();
        await loadStudents();
    }

    await loadRequests();
}

async function createTechnician(event) {
    event.preventDefault();

    if (currentUserData?.role !== "admin") {
        showTechnicianMessage(
            "Administrator access is required.",
            true
        );
        return;
    }

    const submitButton = technicianForm.querySelector(
        'button[type="submit"]'
    );

    const name = technicianName.value.trim();
    const email = technicianEmail.value.trim();
    const password = technicianPassword.value;
    const specialization = technicianSpecialization?.value.trim();

    if (!specialization) {
        showTechnicianMessage(
            "Please select a technician specialization.",
            true
        );
        return;
    }

    submitButton.disabled = true;
    showTechnicianMessage("Creating technician account...");

    try {
        await apiRequest(TECHNICIANS_URL, {
            method: "POST",
            body: JSON.stringify({
                name,
                email,
                password,
                specialization
            })
        });

        technicianForm.reset();

        showTechnicianMessage(
            "Technician account created successfully."
        );

        await loadTechnicians();
        filterRequests();
    } catch (error) {
        showTechnicianMessage(error.message, true);
    } finally {
        submitButton.disabled = false;
    }
}

function showDashboard(user) {
    currentUserData = user;

    authSection.hidden = true;
    appSection.hidden = false;
    userBar.hidden = false;

    const role = user.role;
    const isAdmin = role === "admin";
    const isTechnician = role === "maintenance_staff";

    const displayRole = isTechnician
        ? "Technician"
        : role === "admin"
            ? "Administrator"
            : "Student";

    currentUser.textContent = `${user.name} (${displayRole})`;

    document.getElementById("dashboardTitle").textContent =
        role === "student"
            ? "My Maintenance Dashboard"
            : isTechnician
                ? "Technician Dashboard"
                : "Administrator Dashboard";

    document.getElementById("dashboardDescription").textContent =
        role === "student"
            ? "Report campus problems and track your own requests."
            : isTechnician
                ? "View your assigned maintenance jobs and update their progress."
                : "Manage campus requests, students, create technician accounts, and assign repair jobs.";

    document.getElementById("technicianGuidance").hidden =
        !isTechnician;

    if (technicianManagementSection) {
        technicianManagementSection.hidden = !isAdmin;
    }

    if (studentManagementSection) {
        studentManagementSection.hidden = !isAdmin;
    }

    const statisticCopy = isTechnician
        ? [
            ["Open Jobs", "Pending or in progress"],
            ["Pending", "Jobs awaiting attention"],
            ["In Progress", "Repairs underway"],
            ["Completed", "Resolved jobs"]
        ]
        : [
            ["Total Requests", "Requests visible to you"],
            ["Pending", "Awaiting attention"],
            ["In Progress", "Repairs underway"],
            ["Completed", "Issues resolved"]
        ];

    const statisticIds = [
        ["totalRequestsLabel", "totalRequestsDescription"],
        ["pendingRequestsLabel", "pendingRequestsDescription"],
        ["inProgressRequestsLabel", "inProgressRequestsDescription"],
        ["completedRequestsLabel", "completedRequestsDescription"]
    ];

    statisticIds.forEach(([labelId, descriptionId], index) => {
        document.getElementById(labelId).textContent =
            statisticCopy[index][0];

        document.getElementById(descriptionId).textContent =
            statisticCopy[index][1];
    });

    document.getElementById("requestsEyebrow").textContent =
        isTechnician
            ? "YOUR ASSIGNED JOBS"
            : role === "student"
                ? "REQUEST HISTORY"
                : "REQUEST MANAGEMENT";

    document.getElementById("requestsHeading").textContent =
        isTechnician
            ? "My Assigned Jobs"
            : role === "student"
                ? "My Maintenance Requests"
                : "Maintenance Requests";

    requestSection.hidden = isTechnician;
    studentIdGroup.hidden = !isAdmin;
    studentIdInput.required = isAdmin;

    actionsHeading.textContent = isAdmin
        ? "Actions"
        : isTechnician
            ? "Job"
            : "Access";

    if (technicianForm) {
        technicianForm.removeEventListener("submit", createTechnician);
        technicianForm.addEventListener("submit", createTechnician);
    }

    loadDashboardData();
}

function showLoginScreen() {
    currentUserData = null;
    allRequests = [];
    allTechnicians = [];
    allStudents = [];

    clearPhotoPreview();

    appSection.hidden = true;
    userBar.hidden = true;
    authSection.hidden = false;

    if (technicianManagementSection) {
        technicianManagementSection.hidden = true;
    }

    if (studentManagementSection) {
        studentManagementSection.hidden = true;
    }

    if (studentsTableBody) {
        studentsTableBody.replaceChildren();
    }

    authForm.reset();
    authMode.value = "login";

    updateAuthForm();
}

async function checkExistingSession() {
    try {
        const result = await apiRequest(`${AUTH_URL}/me`);
        showDashboard(result.user);
    } catch {
        showLoginScreen();
    }
}

authMode.addEventListener("change", updateAuthForm);

authForm.addEventListener("submit", async event => {
    event.preventDefault();

    authSubmit.disabled = true;
    showAuthMessage("Please wait...");

    try {
        if (authMode.value === "register") {
            await apiRequest(`${AUTH_URL}/register`, {
                method: "POST",
                body: JSON.stringify({
                    name: authName.value.trim(),
                    studentId: authStudentId.value.trim(),
                    email: authEmail.value.trim(),
                    password: authPassword.value
                })
            });

            authForm.reset();
            authMode.value = "login";

            updateAuthForm();

            showAuthMessage(
                "Account created successfully. Please log in."
            );
        } else {
            const result = await apiRequest(`${AUTH_URL}/login`, {
                method: "POST",
                body: JSON.stringify({
                    email: authEmail.value.trim(),
                    password: authPassword.value
                })
            });

            authForm.reset();
            showDashboard(result.user);
        }
    } catch (error) {
        showAuthMessage(error.message, true);
    } finally {
        authSubmit.disabled = false;
    }
});

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
        await apiRequest(`${AUTH_URL}/logout`, {
            method: "POST"
        });

        showLoginScreen();
    } catch (error) {
        alert(error.message || "Could not log out.");
    } finally {
        logoutButton.disabled = false;
    }
});

requestForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentUserData) {
        showMessage("Please log in before submitting a request.", true);
        return;
    }

    const photo = issuePhotoInput?.files?.[0];

    if (photo) {
        if (!ALLOWED_PHOTO_TYPES.includes(photo.type)) {
            showPhotoMessage("Choose a JPG, PNG, or WebP image.", true);
            return;
        }

        if (photo.size > MAX_PHOTO_SIZE) {
            showPhotoMessage("The image must not exceed 5 MB.", true);
            return;
        }
    }

    const requestData = new FormData();

    requestData.append("hostelId", hostelIdInput.value.trim());
    requestData.append("issue", issueInput.value.trim());
    requestData.append("priority", priorityInput.value);

    if (currentUserData.role === "admin") {
        requestData.append("studentId", studentIdInput.value.trim());
    }

    if (photo) {
        requestData.append("issuePhoto", photo);
    }

    const submitButton = requestForm.querySelector(
        'button[type="submit"]'
    );

    submitButton.disabled = true;
    showMessage("Submitting maintenance request...");

    try {
        await apiRequest(API_URL, {
            method: "POST",
            body: requestData
        });

        showMessage("Maintenance request submitted successfully!");

        requestForm.reset();
        priorityInput.value = "Medium";
        clearPhotoPreview();

        await loadRequests();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        submitButton.disabled = false;
    }
});

async function updateRequestStatus(id, newStatus, button) {
    button.disabled = true;

    try {
        await apiRequest(`${API_URL}/${id}`, {
            method: "PUT",
            body: JSON.stringify({ status: newStatus })
        });

        showMessage("Request status updated successfully!");
        await loadRequests();
    } catch (error) {
        showMessage(error.message, true);
        await loadRequests();
    } finally {
        button.disabled = false;
    }
}

async function deleteRequest(id, button) {
    if (!confirm("Are you sure you want to delete this maintenance request?")) {
        return;
    }

    button.disabled = true;

    try {
        await apiRequest(`${API_URL}/${id}`, {
            method: "DELETE"
        });

        showMessage("Maintenance request deleted successfully!");
        await loadRequests();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
}

searchInput.addEventListener("input", filterRequests);
statusFilter.addEventListener("change", filterRequests);
priorityFilter.addEventListener("change", filterRequests);

resetFilters.addEventListener("click", () => {
    searchInput.value = "";
    statusFilter.value = "All";
    priorityFilter.value = "All";
    filterRequests();
});

if (refreshStudentsButton) {
    refreshStudentsButton.addEventListener("click", loadStudents);
}

updateAuthForm();
checkExistingSession();
