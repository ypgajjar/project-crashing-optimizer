# Project Crashing Optimizer

This is a simple client-side web tool designed to help project managers analyze project crashing scenarios. It allows users to input project activities, their normal and crash durations/costs, and dependencies to determine the critical path and iteratively crash the project in the most cost-effective manner.

The tool is built with HTML, CSS, and vanilla JavaScript, making it easy to host on static site platforms like GitHub Pages.

## Features

*   **Activity Input:** Dynamically add, remove, and edit project activities including:
    *   Activity ID
    *   Activity Name
    *   Predecessor IDs (comma-separated)
    *   Normal Duration
    *   Normal Cost
    *   Crash Duration
    *   Crash Cost
*   **Calculated Fields:** Automatically displays "Max Crash Time" and "Cost per Unit of Time Saved by Crashing" for each activity.
*   **Critical Path Method (CPM):**
    *   Calculates Early Start (ES), Early Finish (EF), Late Start (LS), Late Finish (LF), and Slack for all activities.
    *   Identifies and displays the critical path(s).
*   **Schedule Crashing:**
    *   "Calculate Initial Schedule" button to establish the baseline.
    *   "Crash One Step" button to identify the most cost-effective critical activity to crash by one time unit.
*   **Results Display:**
    *   Initial and Current Project Duration.
    *   Initial and Current Total Project Cost.
    *   Total accumulated crash cost.
    *   Detailed table of all activities with their current CPM values.
*   **Logging:** A log area displays actions taken and messages from the system.
*   **Sample Data:** Load a sample project to quickly see the tool in action.
*   **Reset:** Clear all data and start fresh.

## How to Use

1.  **Open `index.html`:** Open the `index.html` file in your web browser.
2.  **Input Activities:**
    *   Click "Add Activity Row" to add a new task.
    *   Fill in the details for each activity:
        *   **ID:** A unique identifier for the activity (e.g., A, B, 1, 2).
        *   **Activity Name:** A descriptive name for the task.
        *   **Predecessor IDs:** Enter the IDs of activities that must be completed before this one can start, separated by commas (e.g., `A` or `A,B`). Leave blank for starting activities.
        *   **Normal Duration:** The usual time it takes to complete the activity.
        *   **Normal Cost:** The cost associated with the normal duration.
        *   **Crash Duration:** The shortest possible time to complete the activity.
        *   **Crash Cost:** The cost associated with the crash duration.
    *   The "Max Crash" and "Cost/Unit Crash" fields will update automatically as you input duration and cost data.
    *   Use the "Remove" button to delete an activity row.
    *   Alternatively, click "Load Sample Data" to populate the table with an example project.
3.  **Calculate Initial Schedule:** Once all activities are entered, click the "Calculate Initial Schedule" button. This will:
    *   Calculate the project's initial duration and cost.
    *   Determine the critical path(s).
    *   Display detailed CPM values for each activity.
4.  **Crash the Schedule:**
    *   Click the "Crash One Step" button.
    *   The tool will identify the critical activity that can be crashed with the lowest additional cost per unit of time saved.
    *   It will reduce that activity's duration by one time unit, update the project duration and total cost, and recalculate the CPM.
    *   Repeat this step as needed to reach your desired project duration, observing the cost impact.
5.  **Review Results:**
    *   Monitor the "Project Status & Results" section for changes in duration and cost.
    *   Check the "Activity Details & CPM Values" table to see how individual tasks are affected and if the critical path changes.
    *   The "Crashing Log" provides a history of actions.
6.  **Reset:** Click "Reset All Data" to clear the tables and start over.

## PMBOK & AACE Alignment

This tool applies the "Crashing" technique, a schedule compression method described in the PMBOK® Guide. It focuses on making cost-duration trade-offs to shorten the project schedule, which aligns with principles from AACE International's Total Cost Management Framework.

## Limitations

*   **Linear Crashing Costs:** Assumes the cost to crash per unit of time is constant.
*   **No Explicit Resource Modeling:** Does not directly account for resource availability or constraints beyond the costs provided.
*   **Simple Predecessor Logic:** Primarily supports Finish-to-Start relationships.
*   **Client-Side Only:** Data is not saved server-side. If you close the browser tab, input data will be lost unless you have browser features that retain form data (which is unreliable for this purpose).

## To Host on GitHub Pages

1.  Create a new public repository on GitHub.
2.  Upload the `index.html` file, the `css` folder (with `style.css` inside), and the `js` folder (with `app.js` inside) to your repository.
3.  Go to your repository's "Settings" page.
4.  Scroll down to the "GitHub Pages" section.
5.  Under "Source," select the branch you want to deploy from (e.g., `main` or `master`).
6.  Choose the `/ (root)` folder.
7.  Click "Save."
8.  Your site should be published at `http://<your-username>.github.io/<repository-name>/`. It might take a few minutes to become available.