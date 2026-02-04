const NUM_ROWS = 3, NUM_COLS = 3;
const grid = document.getElementById('matrix-grid');
const cells = Array.from(grid.querySelectorAll('.matrix-cell'));
const selectedWordsDiv = document.getElementById('selected-words');
const aiResultDiv = document.getElementById('ai-result');
const completeBtn = document.getElementById('complete-btn');
let selectedWords = [];
let calibrationCenter = null;
let gazeCellIndex = null;
let gazeStableCounter = 0;
const gazeStableThreshold = 18; // How many frames before selection (about 0.5-0.6s if 30fps)

function getRect(elem) {
    const rect = elem.getBoundingClientRect();
    return {x: rect.left, y: rect.top, w: rect.width, h: rect.height};
}

// --- Camera and FaceMesh Setup ---
const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

let faceMesh, camera;
let videoReady = false;

async function setupMediapipe() {
    faceMesh = new window.FaceMesh({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true });

    faceMesh.onResults(onResults);

    camera = new window.Camera(video, {
        onFrame: async () => {
            videoReady = true;
            await faceMesh.send({image: video});
        },
        width: 400,
        height: 300
    });
    camera.start();
}

setupMediapipe();

// --- Calibration ---
document.getElementById('calibrate-btn').onclick = function() {
    if (lastIrisMid) {
        calibrationCenter = {...lastIrisMid}; // Save center as baseline
        alert('Calibrated. Now look at a word to select.');
    } else {
        alert('Please ensure your face is detected.');
    }
};

// --- Gaze to Cell Mapping ---
function getGazeCellIndex(x, y) {
    // Map normalized (0-1) gaze positions to grid cell index
    // x, y ~= (0,0) is left-top, (1,1) is right-bottom
    const col = Math.min(Math.floor(x * NUM_COLS), NUM_COLS-1);
    const row = Math.min(Math.floor(y * NUM_ROWS), NUM_ROWS-1);
    return row * NUM_COLS + col;
}

// --- Gaze and Face Landmark Logic ---
let lastIrisMid = null;

function onResults(results) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length>0) {
        const landmarks = results.multiFaceLandmarks[0];
        // Get left and right iris centers (468 and 473)
        const leftIris = landmarks[468], rightIris = landmarks[473];

        // Draw irises
        for (let lm of [leftIris, rightIris]) {
            ctx.beginPath();
            ctx.arc(lm.x*overlay.width, lm.y*overlay.height, 4, 0, 2*Math.PI);
            ctx.fillStyle = "cyan";
            ctx.fill();
        }

        // Take midpoint between two irises as "gaze" point
        const irisMid = {
            x: (leftIris.x + rightIris.x) / 2,
            y: (leftIris.y + rightIris.y) / 2
        };
        lastIrisMid = irisMid;

        // If calibrated, remap according to calibration center
        let normX = irisMid.x, normY = irisMid.y;
        if (calibrationCenter) {
            // You can make this smarter (add scale/offset if needed)
            // For now, just relative to initial calibration
            normX = Math.min(Math.max(0.5 + (irisMid.x - calibrationCenter.x) * 2.5, 0), 1);
            normY = Math.min(Math.max(0.5 + (irisMid.y - calibrationCenter.y) * 2.5, 0), 1);
        }

        // Highlight cell under gaze
        const idx = getGazeCellIndex(normX, normY);

        for (let i = 0; i < cells.length; ++i) {
            cells[i].classList.toggle('gaze-hover', i === idx);
        }

        // Select cell if gaze stays steady
        if (gazeCellIndex === idx) {
            gazeStableCounter++;
            if (gazeStableCounter === gazeStableThreshold) {
                selectCell(idx);
            }
        } else {
            gazeCellIndex = idx;
            gazeStableCounter = 1;
        }
    } else {
        // Remove gaze hover if face not detected
        cells.forEach(c => c.classList.remove('gaze-hover'));
    }
}

// --- Word Selection Logic ---
function selectCell(idx) {
    const cell = cells[idx];
    if (cell.classList.contains('selected')) return; // Already selected

    cell.classList.add('selected');
    const word = cell.innerText.trim();
    selectedWords.push(word);
    updateSelectedWords();
    if (selectedWords.length >= 3) {
        completeBtn.style.display = 'inline-block';
    }
}

// Reset selection and words
function updateSelectedWords() {
    selectedWordsDiv.textContent = "Selected: " + selectedWords.join(' ');
}

// Complete and speak
completeBtn.onclick = async function() {
    aiResultDiv.textContent = "Waiting for AI...";
    // Use HuggingFace inference API for public project
    const prompt = selectedWords.join(' ');
    const aiText = await completeWithHuggingface(prompt);
    aiResultDiv.textContent = aiText;
    speak(aiText);
    selectedWords = [];
    cells.forEach(c => c.classList.remove('selected'));
    updateSelectedWords();
    completeBtn.style.display = 'none';
};

// --- AI Completion using HuggingFace Inference API ---
// Safer for public demos than OpenAI key in browser
async function completeWithHuggingface(prompt) {
    // Using google/flan-t5-small
    const response = await fetch("https://api-inference.huggingface.co/models/google/flan-t5-small", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: prompt + " ..." })
    });
    const data = await response.json();
    if(data && data[0] && data[0].generated_text) {
        return data[0].generated_text;
    }
    if (Array.isArray(data) && data.length > 0 && data[0].generated_text) {
        return data[0].generated_text;
    }
    return "AI error.";
}

// --- Speech Synthesis ---
function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
}

// --- Allow editing (contenteditable!) ---
cells.forEach(cell => {
    cell.addEventListener('input', function () {
        // Optionally, update display/logic on edit
    });
});

// --- (Optional) Allow deselection of cells on click ---
cells.forEach((cell, idx) => {
    cell.addEventListener('click', function() {
        if (cell.classList.contains('selected')) {
            cell.classList.remove('selected');
            const word = cell.innerText.trim();
            selectedWords = selectedWords.filter(w => w !== word);
            updateSelectedWords();
        } else if (!cell.classList.contains('selected')) {
            selectCell(idx);
        }
    });
});
