# FairLens — AI Hiring Bias Detection Platform

Stack: sklearn + Gemini API + Firebase (no GCP/Vertex/BigQuery needed)

===========================================================================
FOLDER STRUCTURE
===========================================================================

fairlens/
├── backend/
│   ├── app.py                  ← Flask API server (run this)
│   ├── engine.py               ← ML pipeline (GradientBoosting)
│   ├── metrics.py              ← Fairness metric formulas
│   ├── mitigator.py            ← Reweighing + threshold tuning
│   ├── proxy_detector.py       ← Cramér's V proxy detection
│   ├── column_detector.py      ← Auto-detect columns from any CSV
│   ├── gemini_explainer.py     ← Gemini API plain-language explanations
│   ├── firebase_store.py       ← Firestore audit history + user settings
│   ├── auth.py                 ← Firebase Auth token verification
│   ├── requirements.txt        ← Python dependencies
│   └── firebase_credentials.json  ← YOU ADD THIS (from Firebase Console)
├── frontend/
│   ├── public/
│   │   ├── index.html          ← Open this in browser
│   │   └── style.css
│   └── src/
│       ├── api.js
│       ├── charts.js
│       ├── upload.js
│       ├── overview.js
│       ├── metrics.js
│       ├── inspector.js
│       ├── mitigation.js
│       ├── report.js
│       ├── gemini.js           ← AI Explanations panel
│       ├── firebase.js         ← Account & History panel
│       └── main.js
└── data/
    └── fairlens_hiring_dataset.csv   ← Sample dataset to test with


===========================================================================
STEP 1 — INSTALL PYTHON DEPENDENCIES
===========================================================================

Open terminal, go to the project folder:

    cd fairlens/backend
    pip install -r requirements.txt

If you get a permission error add --user:

    pip install -r requirements.txt --user


===========================================================================
STEP 2 — ADD GEMINI API KEY
===========================================================================

Get your free key from:
    https://aistudio.google.com/app/apikey

Then set it in your terminal:

    On Mac/Linux:
        export GEMINI_API_KEY="your_key_here"

    On Windows (Command Prompt):
        set GEMINI_API_KEY=your_key_here

    On Windows (PowerShell):
        $env:GEMINI_API_KEY="your_key_here"

To make it permanent on Mac/Linux, add this line to ~/.bashrc or ~/.zshrc:
    export GEMINI_API_KEY="your_key_here"
Then run: source ~/.bashrc


===========================================================================
STEP 3 — ADD FIREBASE CREDENTIALS
===========================================================================

3a. Go to Firebase Console: console.firebase.google.com
    Open your project (fairlens-webapp)

3b. Click gear icon → Project Settings → Service accounts tab

3c. Click "Generate new private key" → Generate key

3d. A JSON file downloads. Move and rename it:

    On Mac/Linux:
        mv ~/Downloads/fairlens-webapp-firebase-adminsdk-*.json \
           fairlens/backend/firebase_credentials.json

    On Windows:
        Rename the downloaded file to firebase_credentials.json
        Move it into the fairlens/backend/ folder

3e. Set environment variable:

    On Mac/Linux:
        export FIREBASE_CREDENTIALS="firebase_credentials.json"

    On Windows (Command Prompt):
        set FIREBASE_CREDENTIALS=firebase_credentials.json

    On Windows (PowerShell):
        $env:FIREBASE_CREDENTIALS="firebase_credentials.json"


===========================================================================
STEP 4 — ADD FIREBASE CONFIG TO FRONTEND
===========================================================================

4a. In Firebase Console → Project Settings → General tab
    Scroll to "Your apps"
    Click the </> web icon
    Give it nickname: fairlens-web
    Click Register app

4b. Copy the firebaseConfig values shown

4c. Open fairlens/frontend/public/index.html
    Find this block near the top:

        const _firebaseConfig = {
          apiKey:            "YOUR_FIREBASE_API_KEY",
          authDomain:        "YOUR_PROJECT.firebaseapp.com",
          projectId:         "YOUR_PROJECT_ID",
          storageBucket:     "YOUR_PROJECT.appspot.com",
          messagingSenderId: "YOUR_SENDER_ID",
          appId:             "YOUR_APP_ID",
        };

    Replace all YOUR_* values with your real values from step 4b.
    Save the file.


===========================================================================
STEP 5 — ENABLE EMAIL/PASSWORD LOGIN IN FIREBASE
===========================================================================

In Firebase Console:
    Click Authentication in left sidebar
    Click Get started
    Click Email/Password
    Toggle first switch to Enabled
    Click Save


===========================================================================
STEP 6 — SET FIRESTORE RULES
===========================================================================

In Firebase Console:
    Click Firestore Database in left sidebar
    Click Rules tab
    Delete everything and paste:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /audits/{docId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.user_id;
      allow create: if request.auth != null;
    }
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
    match /explanations/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}

    Click Publish


===========================================================================
STEP 7 — RUN THE BACKEND
===========================================================================

Make sure you are in the backend folder:

    cd fairlens/backend

Run:

    python app.py

You should see:

    FairLens API v4.0
    Gemini:   ✓ (if GEMINI_API_KEY is set)
    Firebase: ✓ (if firebase_credentials.json is found)
    http://localhost:5050

If Gemini shows ✗ — check your GEMINI_API_KEY environment variable
If Firebase shows ✗ — check firebase_credentials.json is in the backend folder

Leave this terminal open while using the platform.


===========================================================================
STEP 8 — OPEN THE FRONTEND
===========================================================================

Open a file browser and navigate to:
    fairlens/frontend/public/

Double-click index.html to open it in your browser.

OR open your browser and go to:
    file:///path/to/fairlens/frontend/public/index.html

The top bar should show:
    Backend connected · ✓ Gemini · ✓ Firebase


===========================================================================
STEP 9 — TEST THE PLATFORM
===========================================================================

1. Drop fairlens/data/fairlens_hiring_dataset.csv into the upload zone
2. Review auto-detected columns and click "Confirm & Run Analysis"
3. Wait 15-20 seconds for model training
4. Navigate through all panels:
   - Overview        → bias score, hire rates by group
   - Dataset Bias    → representation gaps, proxy features
   - Model Fairness  → DPD, DIR, EOD, FPR gap
   - Feature/Proxy   → feature importance, proxy risks
   - Inspector       → filter and inspect individual candidates
   - Mitigation      → run reweighing + threshold tuning
   - Audit Report    → full findings + export
   - AI Explanations → Gemini plain-language explanations
   - Account         → register/login to save audit history


===========================================================================
WHAT EACH GOOGLE TOOL DOES IN THIS PROJECT
===========================================================================

Gemini API:
  - Explains fairness metrics in plain English for HR managers
  - Writes executive summary of the full audit
  - Explains why proxy features are risky
  - Explains mitigation results
  - Explains why a flagged candidate's rejection looks suspicious

Firebase (Firestore):
  - Saves every audit run to your account
  - Stores user settings (org name, thresholds)
  - Caches Gemini explanations to avoid repeat API calls
  - Audit history panel shows all past runs


===========================================================================
TROUBLESHOOTING
===========================================================================

"Backend offline" in the browser:
  → Make sure python app.py is running in the terminal

"Gemini ✗":
  → Check: echo $GEMINI_API_KEY in terminal (Mac/Linux)
  → Check: echo %GEMINI_API_KEY% in terminal (Windows)
  → Make sure you set it in the SAME terminal you run python app.py

"Firebase ✗":
  → Check firebase_credentials.json is in fairlens/backend/
  → Check FIREBASE_CREDENTIALS environment variable is set

"CORS error" in browser console:
  → Make sure flask-cors is installed: pip install flask-cors
  → Make sure you are running from backend folder: cd fairlens/backend

"Module not found" error:
  → Run: pip install -r requirements.txt
  → Make sure you are using Python 3.10 or higher: python --version
