document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    
    const activityTableBody = document.getElementById('activityTableBody');
    const addActivityBtn = document.getElementById('addActivityBtn');
    const loadSampleBtn = document.getElementById('loadSampleBtn');
    const calculateInitialBtn = document.getElementById('calculateInitialBtn');
    const crashStepBtn = document.getElementById('crashStepBtn');
    const resetBtn = document.getElementById('resetBtn');

    const initialDurationDisplay = document.getElementById('initialDurationDisplay');
    const initialCostDisplay = document.getElementById('initialCostDisplay');
    const currentDurationDisplay = document.getElementById('currentDurationDisplay');
    const currentCostDisplay = document.getElementById('currentCostDisplay');
    const totalCrashCostDisplay = document.getElementById('totalCrashCostDisplay');
    const criticalPathDiv = document.getElementById('criticalPathDisplay');
    const activityDetailsTableBody = document.getElementById('activityDetailsTableBody');
    const logArea = document.getElementById('logArea');
    const ganttSvgElement = document.getElementById('ganttChartContainer')
    const ganttStartDateInput = document.getElementById('ganttStartDate');
    const redrawGanttBtn = document.getElementById('redrawGanttBtn');
    const loadInputFile = document.getElementById('loadInputFile');
    const exportInputBtnJSON = document.getElementById('exportInputBtnJSON');
    const exportInputBtnCSV = document.getElementById('exportInputBtnCSV');
    const exportReportPDFBtn = document.getElementById('exportReportPDFBtn');
    const loadInputLabel = document.querySelector('label[for="loadInputFile"]');

    // --- Global State ---
    let activities = [];
    let projectIdCounter = 0; // For unique row IDs if activity ID is not provided
    let initialProjectDuration = 0;
    let initialProjectCost = 0;
    let currentProjectDuration = 0;
    let currentTotalCost = 0;
    let accumulatedCrashCost = 0;
    let ganttChartInstance = null;
    let reportEvents = []; // To store { title: string, summary: object, activities: [], logEntry: string, ganttImage: string (dataURL) }

        // --- Activity Class ---
    class Activity {
        constructor(id, name, predecessorsStr, normalDuration, normalCost, crashDuration, crashCost) {
            this.id = id.trim() || `Act${++projectIdCounter}`;
            this.name = name.trim() || `Activity ${this.id}`;

            // For debugging predecessor parsing later if needed
            this.predecessorInputStrings = predecessorsStr ? predecessorsStr.split(',').map(p => p.trim()).filter(p => p) : [];
            this.parsedPredecessors = [];
            this.linkedSuccessors = [];


            logMessage(`DEBUG [Constructor ${this.id}]: Raw inputs: normalDuration="${normalDuration}", normalCost="${normalCost}", crashDuration="${crashDuration}", crashCost="${crashCost}"`, "debug");

            this.normalDuration = parseInt(normalDuration);
            this.normalCost = parseFloat(normalCost);
            this.crashDuration = parseInt(crashDuration);
            this.crashCost = parseFloat(crashCost);

            logMessage(`DEBUG [Constructor ${this.id}]: Parsed values: this.normalDuration=${this.normalDuration}, this.normalCost=${this.normalCost}, this.crashDuration=${this.crashDuration}, this.crashCost=${this.crashCost}`, "debug");

            // Validation
            if (isNaN(this.normalDuration) || this.normalDuration <= 0) {
                logMessage(`ERROR [Constructor ${this.id}]: Normal Duration ("${normalDuration}") is invalid or non-positive. Parsed as ${this.normalDuration}.`, "error");
            }
            if (isNaN(this.normalCost) || this.normalCost < 0) {
                logMessage(`WARNING [Constructor ${this.id}]: Normal Cost ("${normalCost}") is invalid. Parsed as ${this.normalCost}.`, "warning");
            }
            if (isNaN(this.crashDuration) || this.crashDuration <= 0) {
                logMessage(`ERROR [Constructor ${this.id}]: Crash Duration ("${crashDuration}") is invalid or non-positive. Parsed as ${this.crashDuration}.`, "error");
            }
            if (this.crashDuration > this.normalDuration && !isNaN(this.normalDuration)) { // only check if normalDuration is valid
                logMessage(`ERROR [Constructor ${this.id}]: Crash Duration (${this.crashDuration}) cannot be greater than Normal Duration (${this.normalDuration}).`, "error");
                // Potentially throw error or invalidate activity here
            }
            if (isNaN(this.crashCost) || this.crashCost < 0) {
                logMessage(`WARNING [Constructor ${this.id}]: Crash Cost ("${crashCost}") is invalid. Parsed as ${this.crashCost}.`, "warning");
            }
            // Add other necessary validations like crashCost < normalCost when crashDuration < normalDuration

            this.currentDuration = this.normalDuration;
            logMessage(`DEBUG [Constructor ${this.id}]: Set this.currentDuration = ${this.currentDuration}`, "debug");

            this.maxCrashTime = 0; // Initialize
            this.costPerUnitCrash = Infinity; // Initialize

            if (!isNaN(this.normalDuration) && !isNaN(this.crashDuration) && this.normalDuration >= this.crashDuration) {
                this.maxCrashTime = this.normalDuration - this.crashDuration;
                if (this.maxCrashTime > 0 && !isNaN(this.normalCost) && !isNaN(this.crashCost)) {
                    const costDifference = this.crashCost - this.normalCost;
                    this.costPerUnitCrash = costDifference / this.maxCrashTime;
                    if (this.costPerUnitCrash < 0) {
                        logMessage(`INFO [Constructor ${this.id}]: Negative cost per unit crash. Crashing SAVES money.`, "info");
                    }
                } else if (this.maxCrashTime === 0) {
                    this.costPerUnitCrash = Infinity; // Or N/A, cannot be crashed
                }
            } else if (!isNaN(this.normalDuration) && !isNaN(this.crashDuration) && this.crashDuration > this.normalDuration) {
                logMessage(`ERROR [Constructor ${this.id}]: MaxCrashTime calculation error due to invalid crash/normal duration relation.`, "error");
            }


            // CPM Attributes
            this.ES = 0; this.EF = 0; this.LS = Infinity; this.LF = Infinity;
            this.slack = 0; this.isCritical = false;
            this.crashedTime = 0; // ensure crashedTime is initialized
        }

        canCrashFurther() {
            return !isNaN(this.currentDuration) && !isNaN(this.crashDuration) && this.currentDuration > this.crashDuration;
        }

        resetToNormal() {
            logMessage(`DEBUG [resetToNormal ${this.id}]: Resetting. Old currentDuration=${this.currentDuration}. normalDuration=${this.normalDuration}`, "debug");
            this.currentDuration = this.normalDuration;
            this.crashedTime = 0;
            this.ES = 0; this.EF = 0; this.LS = Infinity; this.LF = Infinity;
            this.slack = 0; this.isCritical = false;
            logMessage(`DEBUG [resetToNormal ${this.id}]: New currentDuration=${this.currentDuration}`, "debug");
        }
    }

    // --- HELPER FUNCTIONS ---

    function logMessage(message, type = "info") {
        const timestamp = new Date().toLocaleTimeString();
        // Ensure 'type' is a string and default to "info" if it's null, undefined, or not a recognizable string.
        // Convert to lowercase for consistent checking.
        const typeString = String(type || "info").toLowerCase(); 
        const typeUpperCaseForDisplay = typeString.toUpperCase();

        // Only append to the on-page logArea if the type is NOT "debug"
        if (typeString !== "debug") {
            logArea.value += `[${timestamp}] [${typeUpperCaseForDisplay}] ${message}\n`;
            logArea.scrollTop = logArea.scrollHeight;
        }

        // Still send all messages to the browser's developer console
        // This allows developers to see debug messages if they open the console.
        if (typeString === "error") {
            console.error(`[${typeUpperCaseForDisplay}] ${message}`);
        } else if (typeString === "warning") {
            console.warn(`[${typeUpperCaseForDisplay}] ${message}`);
        } else if (typeString === "debug") {
            console.debug(`[${typeUpperCaseForDisplay}] ${message}`); // Debug messages go to console.debug
        } else { // "info" and any other unrecognized types
            console.log(`[${typeUpperCaseForDisplay}] ${message}`);
        }
    }

    function formatDateForGantt(date) {
        if (!(date instanceof Date) || isNaN(date)) {
            logMessage(`Invalid date provided to formatDateForGantt: ${date}`, "error");
            // Return a default or throw an error, e.g., return "1970-01-01";
            return "2000-01-01"; // Fallback to avoid breaking Gantt library
        }
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function addDaysToDate(baseDate, days) {
        if (!(baseDate instanceof Date) || isNaN(baseDate)) {
            logMessage(`Invalid baseDate provided to addDaysToDate: ${baseDate}`, "error");
            return new Date(2000,0,1); // Fallback
        }
        if (isNaN(days)) {
            logMessage(`Invalid days (${days}) provided to addDaysToDate. Defaulting to 0.`, "warning");
            days = 0;
        }
        const date = new Date(baseDate.valueOf());
        date.setDate(date.getDate() + Math.round(days));
        return date;
    }

    function calculateDurationInDays(startDateStr, endDateStr) {
        const start = new Date(startDateStr);
        const end = new Date(endDateStr);
        // Calculate difference in time, convert to days
        // This calculates the number of full 24-hour periods.
        // If EF is inclusive, you might need to add 1 or adjust.
        // Frappe Gantt usually treats end date as the point where duration ends.
        // So, '2024-01-01' to '2024-01-02' is 1 day duration.
        return Math.round((end - start) / (1000 * 60 * 60 * 24));
    }

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        logMessage(`File "${filename}" prepared for download.`, "info");
    }

    function getInputDataFromTable() {
        const inputData = [];
        const rows = activityTableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('input');
            if (cells.length >= 7) { // Ensure it's a valid activity row
                inputData.push({
                    id: cells[0].value.trim(),
                    name: cells[1].value.trim(),
                    predecessorsStr: cells[2].value.trim(), // Raw predecessor string
                    normalDuration: cells[3].value,
                    normalCost: cells[4].value,
                    crashDuration: cells[5].value,
                    crashCost: cells[6].value
                });
            }
        });
        return inputData;
    }

    function parsePredecessorString(predStr) {
        const trimmedPredStr = predStr.trim();
        if (!trimmedPredStr) {
            throw new Error(`Invalid predecessor format: predecessor string is empty or only whitespace.`);
        }

        // Regex to capture:
        // Group 1: The ID/Name part (anything up to the optional bracket)
        // Group 2: (Optional) The type (FS, SS, FF, SF)
        // Group 3: (Optional, within group 2) The lag number string (e.g., "+2", "-1", "5")
        const typeLagRegex = /^(.*?)(?:\[(FS|SS|FF|SF)\s*(?:([+-]?\d+))?\s*\])?$/i;
        let match = trimmedPredStr.match(typeLagRegex);

        if (match) {
            const idString = match[1].trim(); // ID part, trim spaces around it
            const type = match[2] ? match[2].toUpperCase() : 'FS'; // Default to FS if no type specified
            let lag = 0;

            if (match[3] !== undefined) { // Lag number string was captured
                const parsedLag = parseInt(match[3]);
                if (isNaN(parsedLag)) {
                    throw new Error(`Invalid lag number in predecessor "${trimmedPredStr}". Lag part "${match[3]}" is not a valid integer.`);
                }
                lag = parsedLag;
            }
            // If idString becomes empty after trim (e.g. "[FS+1]"), it's an error
            if (!idString) {
                throw new Error(`Invalid predecessor format: ID part is missing in "${trimmedPredStr}".`);
            }
            return { idString, type, lag };
        } else {
            // This 'else' case should ideally not be reached if the regex is comprehensive enough
            // to always match, even if group 2 and 3 are undefined.
            // However, as a fallback for a simple ID string without brackets:
            return { idString: trimmedPredStr, type: 'FS', lag: 0 };
        }
    }

    function parseCSVInput(csvContent) {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) { // Must have header and at least one data row
            throw new Error("CSV file is empty or has no data rows.");
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '')); // Remove quotes from headers
        const data = [];

        // Expected headers (adjust if your export format differs or you want more flexibility)
        const expectedHeaders = ["ID", "Activity Name", "Predecessor IDs", "Normal Duration", "Normal Cost", "Crash Duration", "Crash Cost"];
        const headerMap = {};
        expectedHeaders.forEach((eh, idx) => {
            const foundIdx = headers.findIndex(h => h.toLowerCase() === eh.toLowerCase());
            if (foundIdx !== -1) {
                headerMap[eh] = foundIdx;
            } else {
                throw new Error(`CSV missing expected header: "${eh}"`);
            }
        });
        

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(','); // Simple CSV split, might need a robust parser for complex CSVs
            if (values.length < expectedHeaders.length) continue; // Skip malformed lines

            const rowData = {
                id: values[headerMap["ID"]].trim().replace(/^"|"$/g, ''),
                name: values[headerMap["Activity Name"]].trim().replace(/^"|"$/g, ''),
                predecessorsStr: values[headerMap["Predecessor IDs"]].trim().replace(/^"|"$/g, ''),
                normalDuration: values[headerMap["Normal Duration"]].trim(),
                normalCost: values[headerMap["Normal Cost"]].trim(),
                crashDuration: values[headerMap["Crash Duration"]].trim(),
                crashCost: values[headerMap["Crash Cost"]].trim()
            };
            data.push(rowData);
        }
        return data;
    }

    // --- CORE LOGIC FUNCTIONS ---

    function addActivityRow(activityData = null) {
    const row = activityTableBody.insertRow();
    row.className = 'activity-row';

    // Ensure that predecessorsStr is correctly sourced if activityData is present
    let predecessorsValue = '';
    if (activityData) {
        if (activityData.predecessorInputStrings && activityData.predecessorInputStrings.length > 0) {
            predecessorsValue = activityData.predecessorInputStrings.join(',');
        } else if (activityData.predecessorsStr) {
            predecessorsValue = activityData.predecessorsStr;
        }
    }

    const cellData = [
        { type: 'text', value: activityData?.id || '', placeholder: 'e.g., A' },
        { type: 'text', value: activityData?.name || '', placeholder: 'e.g., Task 1' },
        { type: 'text', value: predecessorsValue, placeholder: 'e.g., A[FS+1],B[SS]' },
        { type: 'number', value: activityData?.normalDuration || '', placeholder: 'days' },
        { type: 'number', value: activityData?.normalCost || '', placeholder: '$' },
        { type: 'number', value: activityData?.crashDuration || '', placeholder: 'days' },
        { type: 'number', value: activityData?.crashCost || '', placeholder: '$' },
        { type: 'text', value: '', readOnly: true, class: 'calculated-field' }, // Max Crash
        { type: 'text', value: '', readOnly: true, class: 'calculated-field' }, // Cost/Unit
        { type: 'button', text: 'Remove' }
    ];

    cellData.forEach((data, index) => {
        const cell = row.insertCell();
        if (data.type === 'button') {
            const button = document.createElement('button');
            button.textContent = data.text;
            button.className = 'delete-btn';
            button.onclick = () => removeActivityRow(row);
            cell.appendChild(button);
        } else {
            const input = document.createElement('input');
            input.type = data.type;
            // Explicitly convert value to string for input fields, especially for numbers from activityData
            input.value = data.value !== undefined && data.value !== null ? String(data.value) : '';
            input.placeholder = data.placeholder || '';
            if (data.readOnly) input.readOnly = true;
            if (data.class) input.className = data.class;

            if (index === 0 && activityData && activityData.id) {
                logMessage(`DEBUG [addActivityRow]: For ID cell (index 0), activityData.id="${activityData.id}", input.value set to "${input.value}"`, "debug");
            }

            if (index >= 3 && index <= 6) { // Duration/Cost fields
                input.addEventListener('input', () => updateCalculatedFieldsInRow(row));
            }
            cell.appendChild(input);
        }
    });
    updateCalculatedFieldsInRow(row); // Initial calculation for pre-filled data
    }

    function updateCalculatedFieldsInRow(row) {
        const cells = row.cells;
        try {
            const nd = parseFloat(cells[3].querySelector('input').value);
            const cd = parseFloat(cells[5].querySelector('input').value);
            const nc = parseFloat(cells[4].querySelector('input').value);
            const cc = parseFloat(cells[6].querySelector('input').value);

            let maxCrashTime = '';
            let costPerUnit = '';

            if (!isNaN(nd) && !isNaN(cd) && nd >= cd && cd > 0) {
                maxCrashTime = (nd - cd).toString();
                if (!isNaN(nc) && !isNaN(cc) && nd - cd > 0) {
                    if (cc >= nc) {
                         costPerUnit = ((cc - nc) / (nd - cd)).toFixed(2);
                    } else { // Crash cost is less than normal cost
                        costPerUnit = ((cc - nc) / (nd - cd)).toFixed(2) + " (Save)";
                    }
                } else if (nd - cd === 0) {
                     costPerUnit = "N/A";
                }
            } else if (!isNaN(nd) && !isNaN(cd) && nd == cd) {
                maxCrashTime = "0";
                costPerUnit = "N/A";
            }


            cells[7].querySelector('input').value = maxCrashTime;
            cells[8].querySelector('input').value = costPerUnit;
        } catch (e) {
            // Silently fail or log, as this is live input update
            cells[7].querySelector('input').value = '';
            cells[8].querySelector('input').value = '';
        }
    }

    function gatherInputsAndBuildGraph() {
        activities = [];
        projectIdCounter = 0; // Reset for auto-IDs
        let totalNormalCostSum = 0;
        const rows = activityTableBody.querySelectorAll('tr');
        const activityLookupMap = new Map();

        logMessage("DEBUG [gatherInputs]: Starting to build graph. projectIdCounter reset.", "debug");

        // --- First Pass: Create Activity objects and populate lookup map ---
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.querySelectorAll('input');
            if (cells.length < 7) {
                logMessage(`DEBUG [gatherInputs]: Row ${i} is malformed, skipping.`, "debug");
                continue;
            }

            try {
                const userInputId = cells[0].value.trim(); // ID from the input field
                const activityNameFromInput = cells[1].value.trim();
                logMessage(`DEBUG [gatherInputs]: Processing Row ${i}: userInputId="${userInputId}", activityNameFromInput="${activityNameFromInput}"`, "debug");

                const activity = new Activity(
                    userInputId,
                    activityNameFromInput,
                    cells[2].value, // Predecessor string from input
                    cells[3].value, cells[4].value, cells[5].value, cells[6].value
                );
                activities.push(activity);
                totalNormalCostSum += activity.normalCost;

                logMessage(`DEBUG [gatherInputs]: Created Activity: obj.id="${activity.id}", obj.name="${activity.name}"`, "debug");

                // Map by actual final ID (user-provided or auto-generated "ActX")
                // activity.id is guaranteed by constructor to be non-empty.
                if (activityLookupMap.has(activity.id)) {
                    // This means the same explicit ID was used for two different rows,
                    // or an auto-generated ID somehow clashed (highly unlikely with projectIdCounter).
                    const existingActivity = activityLookupMap.get(activity.id);
                    if (existingActivity !== activity) { // Should always be true if it's a true duplicate from different rows
                        logMessage(`ERROR [gatherInputs]: Duplicate ID "${activity.id}" encountered. Original: "${existingActivity.name}", New: "${activity.name}". Using the first one encountered.`, "error");
                        // To be safe, don't overwrite. The first activity with this ID wins.
                    }
                } else {
                    activityLookupMap.set(activity.id, activity);
                    logMessage(`DEBUG [gatherInputs]: Mapped By ID: key="${activity.id}" -> points to activity named "${activity.name}" (ID: ${activity.id})`, "debug");
                }

                // Also map by name, IF the name is not already used as an ID for a *different* activity.
                // And if the name is not already mapped to a *different* activity.
                if (activity.name) {
                    if (activityLookupMap.has(activity.name)) {
                        // Name string is already a key in the map.
                        // Check if it points to the *current* activity (e.g., if ID was same as Name and already mapped)
                        // OR if it points to a *different* activity (ambiguity).
                        if (activityLookupMap.get(activity.name) !== activity) {
                            logMessage(`WARNING [gatherInputs]: Ambiguous Name "${activity.name}". This string is already used as an ID or name for a different activity (ID: "${activityLookupMap.get(activity.name).id}", Name: "${activityLookupMap.get(activity.name).name}"). Predecessor lookup by the name "${activity.name}" will point to the first encountered mapping. Current activity ID being processed: "${activity.id}".`, "warning");
                        } else {
                            logMessage(`DEBUG [gatherInputs]: Name "${activity.name}" was already mapped (likely because ID equals Name, or duplicate name for same object). Key="${activity.name}" points to "${activityLookupMap.get(activity.name).name}".`, "debug");
                        }
                    } else {
                        // Name string is not yet a key, so it's safe to map it.
                        activityLookupMap.set(activity.name, activity);
                        logMessage(`DEBUG [gatherInputs]: Mapped By Name: key="${activity.name}" -> points to activity named "${activity.name}" (ID: ${activity.id})`, "debug");
                    }
                }

            } catch (error) {
                logMessage(`ERROR [gatherInputs First Pass row ${i}]: ${error.message}`, "error");
                throw error; // Stop if activity creation or initial mapping fails
            }
        }
        initialProjectCost = totalNormalCostSum;

        const mapKeysForLogging = Array.from(activityLookupMap.keys());
        logMessage(`DEBUG [gatherInputs]: activityLookupMap final keys before 2nd pass (${mapKeysForLogging.length} keys): ${mapKeysForLogging.join('; ')}`, "debug");


        // --- Second Pass: Parse predecessor strings and link activities ---
        activities.forEach(currentActivity => {
            currentActivity.parsedPredecessors = []; // Reset
            if (!currentActivity.linkedSuccessors) currentActivity.linkedSuccessors = []; // Ensure initialized

            // currentActivity.predecessorInputStrings is populated by the Activity constructor
            // from the raw predecessor string in the input table (cells[2].value)
            currentActivity.predecessorInputStrings.forEach(predInputStr => {
                try {
                    const parsedInfo = parsePredecessorString(predInputStr); // e.g., { idString: "Write Doc", type: "FS", lag: 0 }
                    logMessage(`DEBUG [gatherInputs 2nd Pass]: For currentActivity "${currentActivity.id} (${currentActivity.name})", trying to find predecessor using parsed idString: "${parsedInfo.idString}" (Type: ${parsedInfo.type}, Lag: ${parsedInfo.lag})`, "debug");

                    let predecessorActivity = activityLookupMap.get(parsedInfo.idString);

                    if (!predecessorActivity) {
                        // Log current map state for detailed debugging if lookup fails
                        let detailedMapContents = "Current activityLookupMap contents at point of failure:\n";
                        activityLookupMap.forEach((value, key) => {
                            detailedMapContents += `  Key: "${key}" -> Activity (ID: "${value.id}", Name: "${value.name}")\n`;
                        });
                        logMessage(detailedMapContents, "debug");

                        const errMsg = `Predecessor reference "${parsedInfo.idString}" for activity "${currentActivity.id} (${currentActivity.name})" not found. Check activityLookupMap keys and detailed contents logged above. Ensure predecessor names/IDs are typed exactly as they appear in their respective rows.`;
                        logMessage(errMsg, "error");
                        throw new Error(errMsg);
                    }
                    
                    if (predecessorActivity === currentActivity) {
                        throw new Error(`Activity "${currentActivity.id} (${currentActivity.name})" cannot be its own predecessor ("${parsedInfo.idString}").`);
                    }

                    currentActivity.parsedPredecessors.push({
                        activity: predecessorActivity,
                        type: parsedInfo.type,
                        lag: parsedInfo.lag
                    });

                    if (!predecessorActivity.linkedSuccessors) predecessorActivity.linkedSuccessors = [];
                    predecessorActivity.linkedSuccessors.push({
                        activity: currentActivity,
                        type: parsedInfo.type,
                        lag: parsedInfo.lag
                    });

                } catch (error) {
                    // Avoid double logging if the error is the "Predecessor reference...not found"
                    if (!error.message.startsWith("Predecessor reference")) {
                        logMessage(`ERROR [gatherInputs 2nd Pass, processing pred "${predInputStr}" for "${currentActivity.id} (${currentActivity.name})"]: ${error.message}`, "error");
                    }
                    throw error; // Re-throw to stop calculation
                }
            });
        });
        logMessage("Activity data gathered and graph built with advanced relationships.", "info");
    }

    function calculateCPM() {
    if (activities.length === 0) {
        currentProjectDuration = 0;
        logMessage("No activities to calculate CPM.", "warning");
        return 0;
    }

    // Initialize ES, EF
    activities.forEach(act => {
        act.ES = 0;
        act.EF = act.currentDuration; // Initial EF based on ES=0
    });

    // --- Iterative Forward Pass ---
    let esEfChanged;
    let forwardPassIterations = 0;
    const MAX_ITERATIONS = activities.length * 2; // Heuristic limit

    do {
        esEfChanged = false;
        forwardPassIterations++;

        activities.forEach(act => {
            let newES = 0; // For activities with no predecessors
            if (act.parsedPredecessors.length > 0) {
                act.parsedPredecessors.forEach(predLink => {
                    const predAct = predLink.activity;
                    const type = predLink.type;
                    const lag = predLink.lag;
                    let candidateES = 0;

                    switch (type) {
                        case 'FS':
                            candidateES = predAct.EF + lag;
                            break;
                        case 'SS':
                            candidateES = predAct.ES + lag;
                            break;
                        case 'FF':
                            candidateES = predAct.EF - act.currentDuration + lag;
                            break;
                        case 'SF':
                            candidateES = predAct.ES - act.currentDuration + lag;
                            break;
                        default: // Should not happen if parsing is correct
                            candidateES = predAct.EF + lag; // Default to FS
                    }
                    if (candidateES > newES) {
                        newES = candidateES;
                    }
                });
            }

            if (newES > act.ES) {
                act.ES = newES;
                esEfChanged = true;
            }
            // EF must always be re-calculated if ES changes, or if duration changes (crashing)
            act.EF = act.ES + act.currentDuration;
        });
        
        if (forwardPassIterations > MAX_ITERATIONS) {
            logMessage("Max forward pass iterations reached. Check for circular dependencies or model issues.", "warning");
            break;
        }
    } while (esEfChanged);

    currentProjectDuration = Math.max(...activities.map(act => act.EF), 0);

    // --- Iterative Backward Pass ---
    // Initialize LS, LF
    activities.forEach(act => {
        act.LF = currentProjectDuration;
        act.LS = act.LF - act.currentDuration;
    });

    let lsLfChanged;
    let backwardPassIterations = 0;
    do {
        lsLfChanged = false;
        backwardPassIterations++;
        // Iterate in reverse order of activity definition (simple heuristic, not true topological sort)
        for (let i = activities.length - 1; i >= 0; i--) {
            const act = activities[i];
            let newLF = currentProjectDuration; // For activities with no successors

            if (act.linkedSuccessors.length > 0) {
                act.linkedSuccessors.forEach(succLink => {
                    const succAct = succLink.activity;
                    const type = succLink.type; // Type is how 'act' is a predecessor to 'succAct'
                    const lag = succLink.lag;
                    let candidateLF = currentProjectDuration;

                    switch (type) {
                        case 'FS':
                            candidateLF = succAct.LS - lag;
                            break;
                        case 'SS':
                            // LFp = LSs - lag + DURp
                            candidateLF = succAct.LS - lag + act.currentDuration;
                            break;
                        case 'FF':
                            candidateLF = succAct.LF - lag;
                            break;
                        case 'SF':
                            // LFp = LSs if type is SF for successor (pred.ES drives succ.LF)
                            // This formula for SF on backward pass means: LF_pred = LF_succ if relationship is P(SF)S
                            // If P is SF to S (S.LF depends on P.ES): P.ES = S.LF - lag - S.DUR  (this is wrong)
                            // Standard: LS_pred = LF_succ - lag (if Successor has SF predecessor)
                            candidateLF = succAct.LF - lag + act.currentDuration - succAct.currentDuration;
                            // The backward pass for SF is subtle.
                            // LF_pred = min(LF_pred, ES_succ + DUR_pred - lag) - this requires ES of succ.
                            // Let's use the most common interpretation:
                            // The constraint is on predecessor's START affecting successor's FINISH.
                            // P.ES --> S.LF. So, S.LF = P.ES + lag.
                            // In backward pass, for P: P.LS must be <= S.LF - lag - S.DUR (if S is the successor)
                            // This means P.ES effectively.
                            // LF_pred = min (LF_pred, ES_succ_of_P + Dur_P - lag_SF_between_P_and_its_SF_successor)
                            // This is complex. Simpler: if S is SF to P (S predecessor, P successor): P.LF = S.ES + lag + P.Duration
                            // From P's perspective, if it has an SF successor S:
                            // P.ES <= S.LF - lag. (S.LF is known from its own constraints)
                            // The definition P is SF to S means S cannot finish until P starts.
                            // S.LF >= P.ES + lag. So, P.ES <= S.LF - lag.
                            // For backward pass on P: P.LS = P.ES. So P.LS <= S.LF - lag.
                            // P.LF = P.LS + P.Duration => P.LF <= S.LF - lag + P.Duration.
                            candidateLF = succAct.LS - lag + act.currentDuration; // This is more like SS affecting LF
                            // Let's use a safer one: LSp = min(LSp, LFsucc - lag). This is for SF
                            // Then LFp = LSp + DURp.
                            // So, effectively candidateLF for P based on SF link to S:
                            // newLS_for_P = succAct.LF - lag
                            // candidateLF = newLS_for_P + act.currentDuration

                            // Re-evaluating standard formulas:
                            // Backward Pass (for predecessor P, given successor S):
                            // FS: P.LF = S.LS - lag
                            // SS: P.LS = S.LS - lag => P.LF = (S.LS - lag) + P.Duration
                            // FF: P.LF = S.LF - lag
                            // SF: P.LS = S.LF - lag => P.LF = (S.LF - lag) + P.Duration
                             // So, for SS and SF, we derive the LS first, then LF.
                             let tempLS = act.LS; // Current LS of P
                             if (type === 'SS') tempLS = Math.min(tempLS, succAct.LS - lag);
                             else if (type === 'SF') tempLS = Math.min(tempLS, succAct.LF - lag);

                             if (type === 'SS' || type === 'SF') {
                                 candidateLF = tempLS + act.currentDuration;
                                 // We need to update LS directly if it's an SS or SF successor link
                                 if (tempLS < act.LS) {
                                      act.LS = tempLS; // Update LS for P
                                      lsLfChanged = true;
                                 }
                             }
                             // For FS and FF, candidateLF is directly calculated for P.LF
                            // This logic needs to be careful about updating LS vs LF.
                            // Let's stick to updating LF of predecessor first, then LS derived.
                            // But for SS/SF this means the predecessor's *start* is constrained.
                            // Okay, let's use the direct formulas from scheduling literature for LF of predecessor:
                             // FS: P.LF = S.LS - lag
                             // SS: P.LF = S.LS - lag + P.Duration
                             // FF: P.LF = S.LF - lag
                             // SF: P.LF = S.LF - lag - S.Duration + P.Duration = S.LF - lag
                             // This seems too simple for SF. Let's use one from a reliable source:
                             // Predecessor LF constraint from Successor:
                             //   FS: S.LS - lag
                             //   SS: S.LS - lag + P.Duration
                             //   FF: S.LF - lag
                             //   SF: S.ES - lag + P.Duration (This requires S.ES, problematic in backward pass unless CPM is fully iterative)

                             // Let's simplify and make CPM fully iterative (both passes inside loop)
                             // For now, using a common variant for backward pass:
                             // For Predecessor P:
                             // FS link to S: P.LF = min(P.LF, S.LS - lag)
                             // SS link to S: P.ES = S.ES - lag (used in forward). For backward: P.LS = min(P.LS, S.LS-lag)
                             // FF link to S: P.LF = min(P.LF, S.LF - lag)
                             // SF link to S: P.ES = S.LF - lag (used in forward). For backward: P.LS = min(P.LS, S.LF-lag)
                             // This implies backward pass should calculate LS for P first for SS/SF
                             // For LF for Predecessor P:
                             if (type === 'FS') candidateLF = succAct.LS - lag;
                             else if (type === 'FF') candidateLF = succAct.LF - lag;
                             else if (type === 'SS') candidateLF = (succAct.LS - lag) + act.currentDuration;
                             else if (type === 'SF') candidateLF = (succAct.LF - lag) + act.currentDuration; // Correct if S.LF drives P.LS
                             break; // Default type is FS if type is somehow undefined
                        default: candidateLF = succAct.LS - lag;
                    }


                    if (candidateLF < newLF) { // LF is a minimizing calculation
                        newLF = candidateLF;
                    }
                });
            }


            if (newLF < act.LF) {
                act.LF = newLF;
                lsLfChanged = true;
            }
            // LS must always be re-calculated if LF changes
            act.LS = act.LF - act.currentDuration;
        }
         if (backwardPassIterations > MAX_ITERATIONS) {
             logMessage("Max backward pass iterations reached. Check for circular dependencies or model issues.", "warning");
             break;
         }
    } while (lsLfChanged);


    // Calculate Slack and Critical Path
    let minSlack = Infinity;
    activities.forEach(act => {
        act.slack = act.LS - act.ES;
        // Check for negative slack which indicates an issue or an impossible schedule
        if (act.slack < -0.001) { // Use epsilon for float comparison
            logMessage(`Warning: Activity ${act.id} (${act.name}) has negative slack (${act.slack.toFixed(2)}). The schedule may be infeasible or there's a model error.`, "warning");
        }
        minSlack = Math.min(minSlack, act.slack);
    });

    const epsilon = 0.001;
    activities.forEach(act => {
        act.isCritical = (act.slack - minSlack) < epsilon;
    });

    updateUIDisplay(); // Already exists
    logMessage(`CPM calculated. Project Duration: ${currentProjectDuration.toFixed(2)} units. ForwardPassIter: ${forwardPassIterations}, BackwardPassIter: ${backwardPassIterations}`, "info");
    return currentProjectDuration;
    }

    function updateUIDisplay() {
        currentDurationDisplay.textContent = currentProjectDuration.toFixed(2);
        currentTotalCost = initialProjectCost + accumulatedCrashCost;
        currentCostDisplay.textContent = currentTotalCost.toFixed(2);
        totalCrashCostDisplay.textContent = accumulatedCrashCost.toFixed(2);

        const criticalPaths = activities.filter(act => act.isCritical).map(act => act.id).join(', ');
        criticalPathDiv.innerHTML = `<strong>Critical Path(s):</strong> ${criticalPaths || 'N/A'}`;

        // Update activity details table
        activityDetailsTableBody.innerHTML = ''; // Clear previous entries
        activities.forEach(act => {
            const row = activityDetailsTableBody.insertRow();
            row.className = act.isCritical ? 'critical-true' : 'critical-false';
            row.insertCell().textContent = act.id;
            row.insertCell().textContent = act.name;
            row.insertCell().textContent = act.currentDuration;
            row.insertCell().textContent = act.ES.toFixed(2);
            row.insertCell().textContent = act.EF.toFixed(2);
            row.insertCell().textContent = act.LS.toFixed(2);
            row.insertCell().textContent = act.LF.toFixed(2);
            row.insertCell().textContent = act.slack.toFixed(2);
            row.insertCell().textContent = act.crashedTime;
            row.insertCell().textContent = act.canCrashFurther() ? 'Yes' : 'No';
            row.insertCell().textContent = act.isCritical ? 'Yes' : 'No';
        });
    }

    // --- REPORTING RELATED FUNCTIONS ---

    async function captureReportEvent(title, specificLogMessageForThisEvent = null) {
        logMessage(`Attempting to capture report event: "${title}"`, "debug");

        if (!activities || activities.length === 0) {
            logMessage(`Skipping report event capture for "${title}": No activities loaded.`, "debug");
            return;
        }
        if (!ganttSvgElement) {
            logMessage(`Skipping report event capture for "${title}": Gantt SVG element not found.`, "error");
        }

        let ganttImage = null;
        if (ganttSvgElement && typeof html2canvas === 'function') {
            // Wait for UI updates and Frappe Gantt rendering to hopefully complete
            // This delay is critical for html2canvas to see the rendered chart.
            // You might need to adjust this value based on observed behavior.
            const renderDelay = 1000; // TRY INCREASING THIS (e.g., to 1000ms or 1200ms)
            logMessage(`Waiting ${renderDelay}ms for Gantt to render before capture for event "${title}"...`, "debug");
            await new Promise(resolve => setTimeout(resolve, renderDelay));

            try {
                const ganttContainerToCapture = document.querySelector('.gantt-container'); 
                
                if (ganttContainerToCapture && ganttContainerToCapture.style.display !== 'none' && ganttSvgElement.innerHTML.trim() !== '') {
                    logMessage(`Capturing Gantt image for event: "${title}" (after ${renderDelay}ms delay)`, "debug");
                    const canvas = await html2canvas(ganttContainerToCapture, {
                        scale: 1.5, 
                        logging: false, 
                        useCORS: true,
                        backgroundColor: '#ffffff',
                        // Adding width and height might help html2canvas understand bounds better
                        width: ganttContainerToCapture.scrollWidth, 
                        height: ganttContainerToCapture.scrollHeight,
                        x: 0, // Capture from the top-left of the element
                        y: 0
                    });
                    ganttImage = canvas.toDataURL('image/png');
                    logMessage(`Gantt image captured successfully for "${title}"`, "debug");
                } else {
                    logMessage(`Gantt container not visible or empty for event "${title}" even after delay. Image not captured.`, "debug");
                }
            } catch (err) {
                // ... (error logging as before) ...
            }
        } 
        // ... (rest of captureReportEvent: summary, snapshot, push to reportEvents) ...
        // This part (summary, activitiesSnapshot, logEntry, reportEvents.push) remains the same
        const currentSummary = { /* ... */ }; // Ensure this uses up-to-date global vars
        let activitiesSnapshot = []; try { activitiesSnapshot = JSON.parse(JSON.stringify(activities.map(act => ({ id: act.id, name: act.name, currentDuration: act.currentDuration, normalDuration: act.normalDuration, crashDuration: act.crashDuration, ES: act.ES, EF: act.EF, LS: act.LS, LF: act.LF, slack: act.slack, crashedTime: act.crashedTime, isCritical: act.isCritical })))); } catch (e) { logMessage(`Error creating activities snapshot for "${title}": ${e.message}`, "error");}
        let logEntryForEvent = specificLogMessageForThisEvent; if (!logEntryForEvent) { const logLines = logArea.value.trim().split('\n'); logEntryForEvent = logLines.length > 0 ? logLines[logLines.length - 1] : "Log N/A for this event"; }
        
        reportEvents.push({
            title: title,
            summary: currentSummary,
            activities: activitiesSnapshot,
            logEntry: logEntryForEvent,
            ganttImage: ganttImage
        });
        logMessage(`Report event "${title}" added. Total events: ${reportEvents.length}. Gantt included: ${!!ganttImage}`, "info");
    }

    async function handleExportReportPDF() {
        if (reportEvents.length === 0) {
            alert("No report data to export. Please calculate a schedule and perform actions like crashing.");
            return;
        }

        logMessage("Generating PDF report...", "info");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'l',
            unit: 'pt',
            format: 'a4'
        });

        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 40;
        const contentWidth = pageWidth - 2 * margin;
        let yPos = margin; // Start yPos at margin for the first page

        // Simplified function, as we'll force new pages more often
        function ensureNewPageIfNeeded(neededHeight = 40) {
            if (yPos + neededHeight > pageHeight - margin) {
                doc.addPage();
                yPos = margin;
                doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(0,0,0);
            }
        }
        
        function forceNewPage() {
            if (yPos > margin + 10) { // Only add page if not already at top of a fresh page
                doc.addPage();
            }
            yPos = margin; // Reset yPos for the new page
            doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(0,0,0);
        }


        // --- Report Title (On the first page) ---
        doc.setFontSize(22); doc.setFont(undefined, 'bold');
        doc.text("Project Crashing Analysis Report", pageWidth / 2, yPos, { align: 'center' });
        yPos += 35;
        doc.setFont(undefined, 'normal'); doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - margin, yPos, { align: 'right' });
        yPos += 25;

        // --- Iterate through each captured event ---
        for (let i = 0; i < reportEvents.length; i++) {
            const event = reportEvents[i];

            if (i > 0) { // For every event after the first, start on a new page
                forceNewPage();
            } else { // For the first event, check if title section needs space
                ensureNewPageIfNeeded(60);
            }
            
            doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
            doc.text(event.title, margin, yPos);
            yPos += 25;
            doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(0, 0, 0);

            // Event Specific Summary Table
            const eventSummaryData = [
                ["Current Duration:", (typeof event.summary.duration === 'number' && !isNaN(event.summary.duration)) ? `${event.summary.duration.toFixed(2)} units` : 'N/A'],
                ["Current Total Cost:", (typeof event.summary.cost === 'number' && !isNaN(event.summary.cost)) ? `$${event.summary.cost.toFixed(2)}` : 'N/A'],
                ["Total Crash Cost Added (Cumulative):", (typeof event.summary.crashCost === 'number' && !isNaN(event.summary.crashCost)) ? `$${event.summary.crashCost.toFixed(2)}` : 'N/A'],
                ["Critical Path(s):", event.summary.criticalPath || 'N/A']
            ];
            doc.autoTable({
                startY: yPos, head: [['Metric', 'Value']], body: eventSummaryData,
                theme: 'striped', headStyles: { fillColor: [75, 75, 75], textColor: 255, fontSize: 10 },
                styles: { fontSize: 9, cellPadding: 3 },
                columnStyles: { 0: { fontStyle: 'bold', cellWidth: 200 } },
                tableWidth: 'auto', margin: { left: margin }
            });
            yPos = doc.lastAutoTable.finalY + 15;

            // Associated Log Entry
            if (event.logEntry && event.logEntry !== "N/A") {
                ensureNewPageIfNeeded(25 + (event.logEntry.length / (contentWidth/5) * 10) ); // Estimate height based on text length
                doc.setFontSize(9); doc.setFont(undefined, 'italic');
                const logPrefix = event.title.startsWith("Initial") ? "Calculation Log: " : "Crash Event Log: ";
                const logText = `${logPrefix}${event.logEntry}`;
                const splitLog = doc.splitTextToSize(logText, contentWidth);
                doc.text(splitLog, margin, yPos);
                yPos += (splitLog.length * 10) + 10;
                doc.setFont(undefined, 'normal');
            }

            // Gantt Chart Image for this event
            if (event.ganttImage) {
                const neededHeightForImage = 200 + 20;
                ensureNewPageIfNeeded(neededHeightForImage);
                
                const imgMaxHeight = 200; const imgEffectiveWidth = contentWidth;
                try {
                    const imgProps = doc.getImageProperties(event.ganttImage);
                    const aspectRatio = imgProps.width / imgProps.height;
                    let pdfImgHeight = imgEffectiveWidth / aspectRatio; let pdfImgWidth = imgEffectiveWidth;
                    if (pdfImgHeight > imgMaxHeight) {
                        pdfImgHeight = imgMaxHeight; pdfImgWidth = pdfImgHeight * aspectRatio;
                    }
                    const imgX = margin + (contentWidth - pdfImgWidth) / 2;
                    doc.addImage(event.ganttImage, 'PNG', imgX, yPos, pdfImgWidth, pdfImgHeight);
                    yPos += pdfImgHeight + 20;
                } catch (e) {
                    logMessage(`Error adding Gantt image for "${event.title}" to PDF: ${e.message}`, "error"); console.error("PDF AddImage Error:", e);
                    ensureNewPageIfNeeded(15); doc.setTextColor(255, 0, 0);
                    doc.text("Error embedding Gantt image for this step.", margin, yPos); yPos += 15; doc.setTextColor(0, 0, 0);
                }
            }
        } // End of loop through reportEvents

        // --- Activity Details Table for the FINAL RUN (on a new page) ---
        const finalEvent = reportEvents[reportEvents.length - 1];
        if (finalEvent && finalEvent.activities && finalEvent.activities.length > 0) {
            forceNewPage(); // Start the final details table on a new page

            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text("Final Activity Details & CPM Values:", margin, yPos);
            yPos += 22;
            doc.setFont(undefined, 'normal');

            const activityTableHeaders = [["ID", "Name", "Curr Dur", "ES", "EF", "LS", "LF", "Slack", "Crashed", "Can Crash?", "Critical?"]]; // Added "Can Crash?"
            const activityTableBody = finalEvent.activities.map(act => {
                // We need to recalculate 'canCrashFurther' based on the snapshot data
                const canCrashThisActivity = (typeof act.currentDuration === 'number' && 
                                        typeof act.crashDuration === 'number' && // Assuming crashDuration is in snapshot
                                        act.currentDuration > act.crashDuration);
                return [
                    act.id, act.name,
                    (typeof act.currentDuration === 'number' ? act.currentDuration.toFixed(1) : 'N/A'),
                    (typeof act.ES === 'number' ? act.ES.toFixed(1) : 'N/A'),
                    (typeof act.EF === 'number' ? act.EF.toFixed(1) : 'N/A'),
                    (typeof act.LS === 'number' ? act.LS.toFixed(1) : 'N/A'),
                    (typeof act.LF === 'number' ? act.LF.toFixed(1) : 'N/A'),
                    (typeof act.slack === 'number' ? act.slack.toFixed(1) : 'N/A'),
                    act.crashedTime,
                    canCrashThisActivity ? 'Yes' : 'No', // Added "Can Crash?"
                    act.isCritical ? 'Yes' : 'No'
                ];
            });

            // Inside handleExportReportPDF, for the final activity details table:
            doc.autoTable({
                startY: yPos,
                head: activityTableHeaders,
                body: activityTableBody,
                theme: 'grid',
                headStyles: { 
                    fillColor: [60, 60, 60], 
                    fontSize: 7, // Smaller header font
                    halign: 'center', 
                    textColor: 255,
                    cellPadding: 1 // Minimal padding
                },
                styles: { 
                    fontSize: 6, // Even smaller body font
                    cellPadding: 1, // Minimal padding
                    overflow: 'linebreak', // Attempt to wrap text
                    // lineWidth: 0.1 // Thinner lines if needed
                },
                columnStyles: {
                    // Let's try to make them a bit tighter and ensure all are defined.
                    // Total target width should be < contentWidth (approx 761 pt)
                    // Current sum: 30+80+35+35+35+35+35+35+40+45+45 = 450. This leaves plenty of room.
                    // The error of 197 units overflow means the table was trying to be ~958 pt wide.
                    // This implies one or more columns are getting *much* wider than these settings.

                    0: { cellWidth: 30, halign: 'center' },  // ID
                    1: { cellWidth: 100 },                  // Name (give more space)
                    2: { cellWidth: 35, halign: 'right' },  // Curr Dur
                    3: { cellWidth: 35, halign: 'right' },  // ES
                    4: { cellWidth: 35, halign: 'right' },  // EF
                    5: { cellWidth: 35, halign: 'right' },  // LS
                    6: { cellWidth: 35, halign: 'right' },  // LF
                    7: { cellWidth: 35, halign: 'right' },  // Slack
                    8: { cellWidth: 40, halign: 'right' },  // Crashed
                    9: { cellWidth: 45, halign: 'center' }, // Can Crash?
                    10:{ cellWidth: 45, halign: 'center' }  // Critical?
                },
                tableWidth: 'wrap', // Let AutoTable try to wrap content if columns are too narrow.
                                // If this causes issues, try 'auto' or explicitly contentWidth.
                // tableWidth: contentWidth, // Force table to fit content width (might squeeze columns)
                margin: { left: margin, right: margin }, // Ensure right margin is also respected by AutoTable
                pageBreak: 'auto' // Default, should break page if table exceeds height
            });
            yPos = doc.lastAutoTable.finalY + 20;
        }

        // --- Complete Crashing Log History (on a new page if needed) ---
        forceNewPage(); // Start log history on a new page
        doc.setFontSize(12); doc.setFont(undefined, 'bold');
        doc.text("Complete Crashing Log History", margin, yPos);
        yPos += 20;
        doc.setFontSize(8); doc.setFont(undefined, 'normal');
        const logLinesForPDF = doc.splitTextToSize(logArea.value, contentWidth);
        logLinesForPDF.forEach(line => {
            ensureNewPageIfNeeded(10, true); // Check space for each line of log
            doc.text(line, margin, yPos);
            yPos += 10;
        });

        doc.save('Project_Crashing_Report.pdf');
        logMessage("PDF report generation complete.", "info");
    }

    // --- UI EVENT HANDLER FUNCTIONS ---

    async function handleCalculateInitialSchedule() {
        try {
            reportEvents = [];
            logArea.value = "";
            logMessage("Calculating initial schedule...", "info");

            gatherInputsAndBuildGraph(); // This might throw

            if (activities.length === 0) { /* ... as before ... */ return; }

            activities.forEach(act => act.resetToNormal());
            accumulatedCrashCost = 0;

            calculateCPM(); // This might throw if activities data is bad

            initialProjectDuration = currentProjectDuration;
            initialDurationDisplay.textContent = initialProjectDuration.toFixed(2);
            initialCostDisplay.textContent = initialProjectCost.toFixed(2);
            currentDurationDisplay.textContent = currentProjectDuration.toFixed(2);
            currentCostDisplay.textContent = (initialProjectCost + accumulatedCrashCost).toFixed(2);
            totalCrashCostDisplay.textContent = accumulatedCrashCost.toFixed(2);
            
            drawGanttChart(); // This might throw if Gantt lib has issues

            // Prepare a specific summary log for this event
            const initialLogSummaryForReport = `Initial State - Duration: ${currentProjectDuration.toFixed(2)}, Cost: $${(initialProjectCost + accumulatedCrashCost).toFixed(2)}, Critical Path: ${activities.filter(act => act.isCritical).map(act => act.id).join(', ') || 'N/A'}`;
            await captureReportEvent("Initial Schedule Calculation", initialLogSummaryForReport);

            logMessage("Initial schedule calculation complete.", "info");

        } catch (errorCaught) { // Rename 'error' to 'errorCaught' to avoid confusion
            const errorMessage = errorCaught && errorCaught.message ? errorCaught.message : "An unspecified error occurred during initial calculation.";
            logMessage(`ERROR during initial calculation: ${errorMessage}`, "error");
            alert(`Calculation Error: ${errorMessage}`); // This will now show the actual error message
            reportEvents = [];
        }
    }

    async function handleCrashOneStep() { // Stays async due to captureReportEvent
        try {
            logMessage("Attempting to crash one step...", "info"); // User-facing log
            if (activities.length === 0 || initialProjectDuration === 0) {
                logMessage("Please calculate initial schedule first before crashing.", "warning");
                alert("Please calculate initial schedule first.");
                return;
            }

            // Ensure CPM is current before evaluating crashing options
            // calculateCPM() calls updateUIDisplay() and draws Gantt if it's linked there
            calculateCPM(); 
            // It's important that drawGanttChart() is NOT called here yet if no crash happens.

            const criticalCrashableActivities = activities.filter(act =>
                act.isCritical && 
                act.canCrashFurther() && 
                act.costPerUnitCrash !== Infinity && 
                act.costPerUnitCrash >= 0 // Standard: don't auto-crash if it "saves" money unless a specific feature
            );

            if (criticalCrashableActivities.length === 0) {
                // Determine a more specific reason for not being able to crash
                let noCrashReason = "No further cost-effective crashing can be performed on the critical path."; // Default
                
                const allActivitiesFullyCrashed = activities.every(act => !act.canCrashFurther());
                const noCriticalActivities = activities.every(act => !act.isCritical); // Should not happen if project has duration
                const noCrashableCriticalActivities = activities.filter(act => act.isCritical).every(act => !act.canCrashFurther());

                if (allActivitiesFullyCrashed) {
                    noCrashReason = "All activities in the project are already fully crashed.";
                } else if (noCriticalActivities && currentProjectDuration > 0) {
                    noCrashReason = "No critical path identified, or project is complete. Cannot crash further.";
                } else if (noCrashableCriticalActivities) {
                    noCrashReason = "All activities on the current critical path(s) are already fully crashed or cannot be crashed.";
                } else if (activities.filter(act => act.isCritical && act.canCrashFurther() && act.costPerUnitCrash !== Infinity).length === 0) {
                    // This implies critical crashable activities exist but their costPerUnitCrash < 0
                    noCrashReason = "No critical activities can be crashed at a non-negative cost. (Negative cost crashing is disabled for 'Crash One Step').";
                }

                logMessage(noCrashReason, "warning"); // Log it as a warning, as it's an important user feedback
                alert(noCrashReason); // Alert the user
                return; // IMPORTANT: Exit the function, no crash happened
            }

            // Sort to find the cheapest to crash
            criticalCrashableActivities.sort((a, b) => a.costPerUnitCrash - b.costPerUnitCrash);
            const activityToCrash = criticalCrashableActivities[0];

            // This check is mostly redundant due to the filter, but a good safeguard
            if (activityToCrash.costPerUnitCrash === Infinity) {
                logMessage(`Safeguard: Selected activity ${activityToCrash.id} has Infinity crash cost. Cannot crash.`, "warning");
                alert(`Activity ${activityToCrash.id} cannot be crashed further or has infinite cost.`);
                return; // Exit
            }

            // Prepare messages *before* applying the crash to capture old duration
            const oldDurationOfCrashedActivity = activityToCrash.currentDuration;
            const crashEventTitle = `After Crashing: ${activityToCrash.name} (ID: ${activityToCrash.id})`;
            
            // Perform the crash
            activityToCrash.currentDuration -= 1;
            activityToCrash.crashedTime += 1;
            accumulatedCrashCost += activityToCrash.costPerUnitCrash;
            
            // Recalculate CPM *after* the crash has been applied
            calculateCPM(); 

            // Construct the detailed log message *after* CPM recalculation to get new project duration
            const finalCrashLogMessage = `CRASHED: Activity "${activityToCrash.id} (${activityToCrash.name})" by 1 unit. Cost: +$${activityToCrash.costPerUnitCrash.toFixed(2)}. Duration: ${oldDurationOfCrashedActivity} -> ${activityToCrash.currentDuration}. New Project Duration: ${currentProjectDuration.toFixed(2)}. New Total Cost: $${currentTotalCost.toFixed(2)}.`;
            logMessage(finalCrashLogMessage, "info"); // Log the successful action

            drawGanttChart(); // Redraw Gantt chart with updated schedule

            await captureReportEvent(crashEventTitle, finalCrashLogMessage); 

            // logMessage(`Crashing step complete. New Project Duration: ${currentProjectDuration.toFixed(2)}`, "info"); // This is now part of finalCrashLogMessage

        } catch (errorCaught) {
            const errorMessage = errorCaught && errorCaught.message ? errorCaught.message : "An unspecified error occurred during crashing step.";
            logMessage(`ERROR during crashing step: ${errorMessage}`, "error");
            alert(`Crashing Error: ${errorMessage}`);
        }
    }

    function handleLoadInputFile(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result;
            try {
                let loadedData;
                if (file.name.endsWith('.json')) {
                    loadedData = JSON.parse(content);
                } else if (file.name.endsWith('.csv')) {
                    loadedData = parseCSVInput(content);
                } else {
                    alert("Unsupported file type. Please load a .json or .csv file.");
                    return;
                }

                if (!Array.isArray(loadedData) || loadedData.length === 0) {
                    alert("File is empty or not in the expected array format.");
                    return;
                }

                // Validate structure of the first item (basic check)
                const firstItem = loadedData[0];
                if (typeof firstItem.name === 'undefined' || 
                    typeof firstItem.normalDuration === 'undefined' ||
                    typeof firstItem.predecessorsStr === 'undefined' ) { // Add more checks as needed
                    alert("File content does not match expected activity data structure.");
                    return;
                }

                resetAllData(); // Clear current table and state

                loadedData.forEach(activityData => {
                    // `addActivityRow` expects an object similar to what `getInputDataFromTable` produces
                    // or the sample data structure.
                    addActivityRow(activityData); 
                });
                logMessage(`Input data loaded from "${file.name}". Calculate schedule to proceed.`, "info");

            } catch (err) {
                logMessage(`Error loading or parsing file: ${err.message}`, "error");
                alert(`Error processing file: ${err.message}`);
            } finally {
                // Reset file input to allow loading the same file again if needed
                event.target.value = null;
            }
        };
        reader.onerror = function() {
            alert("Error reading file.");
            logMessage("Error reading file with FileReader.", "error");
            event.target.value = null;
        };

        if (file.name.endsWith('.json')) {
            reader.readAsText(file);
        } else if (file.name.endsWith('.csv')) {
            reader.readAsText(file);
        }
    }

    function handleExportInputJSON() {
        const inputData = getInputDataFromTable();
        if (inputData.length === 0) {
            alert("No input data to export.");
            return;
        }
        const jsonContent = JSON.stringify(inputData, null, 2); // Pretty print JSON
        downloadFile('project_input_data.json', jsonContent, 'application/json');
    }

    function handleExportInputCSV() {
        const inputData = getInputDataFromTable();
        if (inputData.length === 0) {
            alert("No input data to export.");
            return;
        }
        
        // Define CSV headers
        const headers = ["ID", "Activity Name", "Predecessor IDs", "Normal Duration", "Normal Cost", "Crash Duration", "Crash Cost"];
        let csvContent = headers.join(',') + '\n';

        inputData.forEach(row => {
            const values = [
                `"${row.id.replace(/"/g, '""')}"`, // Escape double quotes for CSV
                `"${row.name.replace(/"/g, '""')}"`,
                `"${row.predecessorsStr.replace(/"/g, '""')}"`,
                row.normalDuration,
                row.normalCost,
                row.crashDuration,
                row.crashCost
            ];
            csvContent += values.join(',') + '\n';
        });
        downloadFile('project_input_data.csv', csvContent, 'text/csv;charset=utf-8;');
    }

    function resetAllData() {
        activities = [];
        activityTableBody.innerHTML = '';
        activityDetailsTableBody.innerHTML = '';
        logArea.value = '';
        reportEvents = [];

        initialProjectDuration = 0;
        initialProjectCost = 0;
        currentProjectDuration = 0;
        currentTotalCost = 0;
        accumulatedCrashCost = 0;
        projectIdCounter = 0;

        initialDurationDisplay.textContent = 'N/A';
        initialCostDisplay.textContent = 'N/A';
        currentDurationDisplay.textContent = 'N/A';
        currentCostDisplay.textContent = 'N/A';
        totalCrashCostDisplay.textContent = '0.00';
        criticalPathDiv.innerHTML = '<strong>Critical Path(s):</strong> N/A';
        if (ganttChartInstance) {
            try { ganttChartInstance.clear(); } catch(e) {/* ignore */}
            ganttChartInstance = null;
        }
        if (ganttSvgElement) {
            ganttSvgElement.innerHTML = '';
            ganttSvgElement.style.display = 'none';
        }
        ganttStartDateInput.value = ''; // Clear the Gantt start date input
        

        logMessage("All data has been reset.", "info");
    }

    function loadSampleData() {
        resetAllData(); // Clear existing data first
        logMessage("Loading sample project data...", "info");
        const sampleActivities = [
            { id: 'A', name: 'Design', predecessorsStr: '', normalDuration: 5, normalCost: 500, crashDuration: 3, crashCost: 900 },
            { id: 'B', name: 'Build Proto', predecessorsStr: 'A', normalDuration: 7, normalCost: 700, crashDuration: 5, crashCost: 1000 },
            { id: 'C', name: 'Test Proto', predecessorsStr: 'B', normalDuration: 3, normalCost: 300, crashDuration: 2, crashCost: 500 },
            { id: 'D', name: 'Write Docs', predecessorsStr: 'A', normalDuration: 4, normalCost: 200, crashDuration: 3, crashCost: 300 },
            { id: 'E', name: 'Release', predecessorsStr: 'C,D', normalDuration: 2, normalCost: 100, crashDuration: 1, crashCost: 400 }
        ];
        sampleActivities.forEach(act => addActivityRow(act));
        logMessage("Sample data loaded. Calculate initial schedule to proceed.", "info");
    }

    function drawGanttChart() {
        if (!ganttSvgElement) {
            logMessage("Gantt SVG container element not found in DOM.", "error");
            return;
        }

        // 1. Destroy previous Gantt instance if it exists
        if (ganttChartInstance) {
            try {
                // Frappe Gantt might not have a formal destroy method.
                // Clearing tasks and nullifying is the common approach.
                ganttChartInstance.clear(); 
                logMessage("Previous Gantt instance tasks cleared.", "debug");
            } catch (e) {
                logMessage(`Debug: Error trying to clear previous Gantt instance: ${e.message}`, "debug");
            }
            ganttChartInstance = null; // Nullify the instance
        }

        // 2. Clear the SVG container's content directly
        ganttSvgElement.innerHTML = ''; 
        logMessage("Gantt SVG container cleared.", "debug");


        if (!activities || activities.length === 0) {
            // Display message if no activities
            const p = document.createElement('p');
            p.textContent = 'No activities to display. Calculate schedule first.';
            p.style.textAlign = 'center'; p.style.padding = '20px';
            if (ganttSvgElement.parentNode) {
                // Insert the message before the (now empty) SVG container
                ganttSvgElement.parentNode.insertBefore(p, ganttSvgElement);
                // Hide the SVG element itself if there's nothing to draw
                ganttSvgElement.style.display = 'none';
            }
            // Remove any previously added message if we are here from a state that had one
            const existingMsg = ganttSvgElement.parentNode.querySelector('p.gantt-empty-message');
            if (existingMsg && activities.length > 0) existingMsg.remove();

            return;
        }
        
        // Ensure SVG is visible if we are going to draw in it
        ganttSvgElement.style.display = 'block';
        // Remove any "no activities" message if it exists
        const existingMsg = ganttSvgElement.parentNode.querySelector('p.gantt-empty-message');
        if (existingMsg) existingMsg.remove();


        let userGanttStartDateStr = ganttStartDateInput.value;
        let projectStartDateForGantt;
        if (userGanttStartDateStr) {
            const parts = userGanttStartDateStr.split('-');
            projectStartDateForGantt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
        } else {
            projectStartDateForGantt = new Date(Date.UTC(new Date().getFullYear(), 0, 1));
            ganttStartDateInput.value = formatDateForGantt(projectStartDateForGantt);
        }
        logMessage(`Gantt chart drawing with timeline start: ${formatDateForGantt(projectStartDateForGantt)}`, "debug");

        const tasksForGantt = activities.map(act => {
            if (isNaN(act.ES) || isNaN(act.EF)) {
                logMessage(`Activity ${act.id} (${act.name}) has NaN ES/EF values. ES=${act.ES}, EF=${act.EF}. Skipping for Gantt.`, "warning");
                return null;
            }
            const taskStart = addDaysToDate(projectStartDateForGantt, act.ES);
            const taskEnd = addDaysToDate(projectStartDateForGantt, act.EF);
            const dependencyIds = act.parsedPredecessors.map(pLink => pLink.activity.id).join(',');
            return {
                id: act.id, name: `${act.name}`,
                start: formatDateForGantt(taskStart), end: formatDateForGantt(taskEnd),
                progress: 0, dependencies: dependencyIds,
                custom_class: act.isCritical ? 'bar-critical' : 'bar-normal'
            };
        }).filter(task => task !== null);

        if (tasksForGantt.length === 0 && activities.length > 0) {
            logMessage("All activities had invalid dates for Gantt display (after filtering).", "warning");
            const p = document.createElement('p');
            p.textContent = 'Could not display tasks; check ES/EF values (all were invalid).';
            p.className = 'gantt-empty-message'; // Add class for easier removal
            p.style.textAlign = 'center'; p.style.padding = '20px';
            if (ganttSvgElement.parentNode) ganttSvgElement.parentNode.insertBefore(p, ganttSvgElement);
            ganttSvgElement.style.display = 'none';
            return;
        }
        
        if (tasksForGantt.length > 0) {
            try {
                logMessage(`Initializing new Gantt chart with ${tasksForGantt.length} tasks.`, "debug");
                ganttChartInstance = new Gantt(ganttSvgElement, tasksForGantt, {
                    header_height: 50, column_width: 30, step: 24,
                    view_modes: ['Day', 'Week', 'Month', 'Year'],
                    bar_height: 20, bar_corner_radius: 3, arrow_curve: 5, padding: 18,
                    view_mode: 'Week', date_format: 'YYYY-MM-DD', language: 'en',
                    custom_popup_html: function (task) {
                        // ... (popup HTML remains the same)
                        const activity = activities.find(a => a.id === task.id);
                        if (!activity) return `<strong>${task.name || task.id}</strong>`;
                        return `<div class="gantt-popup-wrapper"><h5>${activity.name} (ID: ${activity.id})</h5><p>Duration: ${activity.currentDuration.toFixed(1)} u</p><p>ES: ${activity.ES.toFixed(1)}, EF: ${activity.EF.toFixed(1)}</p><p>LS: ${activity.LS.toFixed(1)}, LF: ${activity.LF.toFixed(1)}</p><p>Slack: ${activity.slack.toFixed(1)}</p><p>Critical: ${activity.isCritical ? '<strong>Yes</strong>' : 'No'}</p><p style="margin-top:8px; font-size:11px;">Start: ${task.start} | End: ${task.end}</p></div>`;
                    }
                    // NO on_date_change for view-only
                });
                logMessage("Gantt chart drawn/updated successfully.", "info");
            } catch(e) {
                logMessage(`Error initializing/drawing Gantt chart: ${e.message}`, "error");
                console.error("Gantt Init/Draw Error:", e);
                ganttSvgElement.innerHTML = `<p style="color:red; text-align:center; padding:20px;">Error displaying Gantt chart. See console.</p>`;
            }
        } else {
            // This case should be covered by the earlier check for `activities.length === 0`
            // or `tasksForGantt.length === 0 && activities.length > 0`
            logMessage("No valid tasks to draw in Gantt chart.", "debug");
        }
    }

    function removeActivityRow(row) {
        activityTableBody.removeChild(row);
        logMessage("Activity row removed.", "info");
    }

    // --- Event Listeners ---
    addActivityBtn.addEventListener('click', addActivityRow);
    loadSampleBtn.addEventListener('click', loadSampleData);
    calculateInitialBtn.addEventListener('click', handleCalculateInitialSchedule);
    crashStepBtn.addEventListener('click', handleCrashOneStep);
    resetBtn.addEventListener('click', resetAllData);
    redrawGanttBtn.addEventListener('click', () => {
        if (activities && activities.length > 0) { // Only redraw if there's data
            drawGanttChart();
        } else {
            logMessage("No activity data to draw Gantt chart.", "info");
        }
    });
    loadInputFile.addEventListener('change', handleLoadInputFile);
    exportInputBtnJSON.addEventListener('click', handleExportInputJSON);
    exportInputBtnCSV.addEventListener('click', handleExportInputCSV);
    exportReportPDFBtn.addEventListener('click', handleExportReportPDF);
    // Trigger file input click when label is clicked
    if (loadInputLabel) {
        loadInputLabel.addEventListener('click', (event) => { // Add the event parameter
            event.preventDefault(); // PREVENT THE DEFAULT LABEL ACTION
            
            // It's good practice to reset the file input's value before clicking it.
            // This allows the user to select the same file again if they cancelled
            // or if the previous load failed, and the 'change' event will still fire.
            loadInputFile.value = null; 
            
            loadInputFile.click();  // Now, only this click will open the dialog
        });
    }

    

    // --- Initial Page Setup ---
    addActivityRow(); // Start with one empty row
    logMessage("Project Crashing Optimizer initialized.", "info");
    if(ganttSvgElement) ganttSvgElement.style.display = 'none'; // Hide Gantt initially
});