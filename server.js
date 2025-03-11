const express = require('express'); 

require("dotenv").config();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const url = process.env.mongourl;
const jwtpassword = process.env.jsonpassword;

// Initialize Express App
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Gemini AI 
const genAI = new GoogleGenerativeAI(process.env.gemini_key);

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Import Mongoose Models
const { User, Score, QA, Qno } = require("./model.js");


async function finduser(username) {
    return await User.findOne({ username: username });
}




// Signin Route (Fixed reference to `User`)
app.post('/signin', async (req, res) => {
    try {
        const existingUser = await User.findOne({ 
            username: req.headers["username"], 
            password: req.headers["password"] 
        });

        if (existingUser) {
            const token = jwt.sign({ username: req.headers["username"] }, jwtpassword, { expiresIn: '1h' });
            return res.json({ "mes": "true", "jwttoken": token });
        } else {
            return res.json({ "mes": "false" });
        }
    } catch (error) {
        console.error("Signin Error:", error);
        res.status(500).json({ "error": "Internal Server Error" });
    }
});

// Score Calculation & Feedback
app.post('/score', async (req, res) => {
    try {
        const username = req.headers["username"];
        if (!username) return res.status(400).json({ error: "Username is required" });

        let lastscore = await Score.findOne({ username });

        if (!lastscore) {
            lastscore = new Score({ username, lastscore: "" });
            await lastscore.save();
        }

        let q = await QA.findOne({ username }).select('questionanswer');

        if (!q) return res.status(404).json({ error: "No interview responses found for the user" });

        const questionAnswer = q.questionanswer;
        const prompt = `Analyze the interview responses and provide a single overall interview score out of 10 (just the number, nothing else): ${questionAnswer}`;
        const prompt1 = `Analyze the interview responses given by the user: ${questionAnswer}. Provide improvement suggestions for each answer separately.`;

        const result = await model.generateContent(prompt);
        let score = result?.response?.text?.() || "0";
        score = score.replace(/\D/g, ""); // Extract only numbers

        lastscore.lastscore += lastscore.lastscore ? `_${score}` : score;
        await lastscore.save();

        const result1 = await model.generateContent(prompt1);
        const suggestion = result1?.response?.text?.() || "No suggestion available";

        q.questionanswer = "";
        await q.save();

        // ✅ Fix: Retrieve the `qnoRecord` correctly
        let qnoRecord = await QA.findOne({ username }).select('qno');

        if (qnoRecord) {
            qnoRecord.qno = "1"; // Reset qno to 1
            await qnoRecord.save();
        }

        res.json({
            "overall_score": `${score}/10`,
            "suggestions": suggestion
        });

    } catch (error) {
        console.error("❌ Error Details:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

app.post("/interview", async (req, res) => {
    try {
        const username = req.header('username');

        let qaRecord = await QA.findOne({ username });
        if (!qaRecord) {
            qaRecord = new QA({ username, questionanswer: '' });
            await qaRecord.save();
        }

        let qnoRecord = await Qno.findOne({ username });
        if (!qnoRecord) {
            qnoRecord = new Qno({ username, qno: "0" });
            await qnoRecord.save();
        }

        let i = parseInt(qnoRecord.qno, 10);

        let prompt1;
        if (i === 0) {
            prompt1 = `Generate a professional interview question.`;
        } else {
            prompt1 = `Based on the previous question, generate a follow-up question: ${qaRecord.questionanswer}`;
        }

        const result1 = await model.generateContent(prompt1);
        const question = await result1.response.text();

        qaRecord.questionanswer += `\nQ${i + 1}: ${question}`;
        await qaRecord.save();

        qnoRecord.qno = (i + 1).toString();
        await qnoRecord.save();

        res.json({
            "qno": i + 1,
            "question": question
        });

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// Store Answer in Database
app.post("/addanswer", async (req, res) => {
    try {
        const username = req.header('username');
        const answer = req.body.answer;

        let qaRecord = await QA.findOne({ username });
        if (!qaRecord) {
            qaRecord = new QA({ username, questionanswer: '' });
            await qaRecord.save();
        }

        let qnoRecord = await Qno.findOne({ username });
        if (!qnoRecord) {
            return res.status(400).json({ error: "No question found for the user" });
        }

        let i = parseInt(qnoRecord.qno, 10);
        qaRecord.questionanswer += `\nA${i}: ${answer}`;
        await qaRecord.save();

        res.json({ "mes": "Added the answer to the database" });
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// Reset Interview History
app.post("/home", async (req, res) => {
    try {
        const username = req.header('username');

        await QA.deleteOne({ username });
        await Qno.deleteOne({ username });

        res.json({ "message": "true" });
    } catch (error) {
        res.status(500).json({ "error": "Internal Server Error" });
    }
});

// Check Score & Analyze Progress
app.post("/checkscore", async (req, res) => {
    const username = req.header('username');
    const token = req.header('jwttoken');

    try {
        const decoded = jwt.verify(token, jwtpassword);
        const userScore = await Score.findOne({ username });

        if (!userScore) {
            return res.json({ "validUser": true, "array": [], "suggestion": "No score history found." });
        }

        const lastScores = userScore.lastscore.split("_").filter(score => score !== "").map(Number);
        const lastFiveScores = lastScores.slice(-5); // Get last 5 scores

        if (lastFiveScores.length >= 5) {
            const prompt2 = `Analyze the progress of the user's last 5 scores out of 10 in 70 words: ${lastFiveScores}`;
            const r2 = await model.generateContent(prompt2);

            return res.json({
                "validUser": true,
                "array": lastFiveScores,
                "suggestion": await r2.response.text(),
            });
        } else {
            return res.json({ "validUser": true, "array": lastFiveScores, "suggestion": "Not enough scores to analyze." });
        }
    } catch (err) {
        console.error("JWT Verification Failed:", err.message);
        return res.status(401).json({ "validUser": false, "array": [], "suggestion": "Invalid or expired token." });
    }
});

// MongoDB Connection
mongoose.connect(url)
    .then(() => {
        console.log("Connected to MongoDB!");
        app.listen(3000, () => {
            console.log("Server is running on port 3000");
        });
    })
    .catch((error) => {
        console.error("MongoDB connection error:", error);
    });
