const express = require('express'); 
require("dotenv").config();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const url = process.env.mongourl;
const jwtpassword = process.env.jsonpassword;
const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
const genAI = new GoogleGenerativeAI(process.env.gemini_key);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const { User, Score, QA, Qno ,Image} = require("./model.js");


function verifyjson(token, jwtpassword) {
    try {
        const decoded = jwt.verify(token, jwtpassword);
        return decoded.username;
    } catch (error) {
        return { error: "Invalid token" };
    }
}


async function finduser(username) {
    return await User.findOne({ username: username });
}

app.post('/signup', async (req, res) => {
    try {
        const existingUser = await finduser(req.headers["username"]);
        
        if (existingUser) {
            return res.json({ mes: false });
        }

        const newUser = new User({
            username: req.headers["username"],
            password: req.headers["password"]
        });

        await newUser.save();

        res.json({ mes: true });
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ mes: "Internal server error" });
    }
});



// Signin Route 
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
    console.log("✅ /score endpoint hit");

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

        const feedbackPrompt = `
Analyze the following interview responses: ${questionAnswer}
Provide a structured JSON object with the following format:
{
  "overall_score": "x/10",
  "overall_feedback": "<brief summary>",
  "date": "<current datetime in format: Mar 21, 2025 12:53 AM>",
  "breakdown": {
    "Communication Skills": {
      "score": "x/10",
      "feedback": "<feedback>"
    },
    "Technical Knowledge": {
      "score": "x/10",
      "feedback": "<feedback>"
    },
    "Problem Solving": {
      "score": "x/10",
      "feedback": "<feedback>"
    },
  
    "Confidence and Clarity": {
      "score": "x/10",
      "feedback": "<feedback>"
    }
  },
  "strengths": "<summary of strengths>",
  "areas_for_improvement": [
    "<point 1>",
    "<point 2>",
    "<point 3>"
  ]
}
Only return valid JSON. Do not add commentary.
`;

        const result = await model.generateContent(feedbackPrompt);

        let feedbackJson = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        console.log("🔍 Raw model output:\n", feedbackJson);


        if (feedbackJson.startsWith("```json")) {
            feedbackJson = feedbackJson.replace(/^```json\s*/, "").replace(/```$/, "").trim();
        }

        let parsed;
        try {
            parsed = JSON.parse(feedbackJson);
        } catch (e) {
            console.error("❌ Failed JSON:\n", feedbackJson);
            throw new Error("Failed to parse model output as JSON.");
        }

  
        const numericScore = parsed.overall_score?.match(/\d+/)?.[0] || "0";
        lastscore.lastscore += lastscore.lastscore ? `_${numericScore}` : numericScore;
        await lastscore.save();


        q.questionanswer = "";
        await q.save();


        let qnoRecord = await QA.findOne({ username }).select('qno');
        if (qnoRecord) {
            qnoRecord.qno = "1";
            await qnoRecord.save();
        }

        res.json(parsed);

    } catch (error) {
        console.error("❌ Error Details:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});


app.post("/interview", async (req, res) => {
    try {
        const username = req.header("username");
        const { domain, numberofquestion } = req.body;

        if (!domain) {
            return res.status(400).json({ error: "Domain is required" });
        }

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
            prompt1 = `Generate a professional interview question in the domain of "${domain}". This student has just graduated and might not have that much experience. ASk a easier question.`;
        } else {
            prompt1 = `Based on this previous Q&A history, generate a relevant follow-up interview question in the domain of "${domain}":\n${qaRecord.questionanswer}Only output the question itself. Do not include analysis, explanation, or commentary. Also gradually increase the toughness in the questions`;
        }

        const result1 = await model.generateContent(prompt1);
        const question = await result1.response.text();

        qaRecord.questionanswer += `\nQ${i + 1}: ${question}`;
        await qaRecord.save();

        qnoRecord.qno = (i + 1).toString();
        await qnoRecord.save();

        res.json({
            qno: i + 1,
            question: question
        });

    } catch (error) {
        console.error("Interview generation error:", error);
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


app.post("/checkresume", async (req, res) => {
    console.log("Received request:", req.body); 

    try {
        const username = verifyjson(req.headers.jwttoken);
        if (!username) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const { resume, profile } = req.body;
        if (!resume || !profile) {
            return res.status(400).json({ error: "Resume and profile are required" });
        }

        // Prepare prompts
        const prompt1 = `${resume} This is my resume. I am focusing on the job for ${profile}. First, just only give the score of my resume out of 10.and never give the line like The formatting is also inconsistent and contains errors.   if you see this in resume ignor this part const corrections = {
        "B": "Ray optics",
        "Duol Natre": "Dual Nature",
        "Radiation and M": "Radiation and Matter",
        "a ffoms": "Atoms",
        "Nuclei 1": "Nuclei",
        "Semiconductor": "Semiconductor"
      };`;
        const prompt2 = `${resume} This is my resume. I am focusing on the job for ${profile}. What are the good things about my resume? Give them in bullet form in 50-70 words.if you see this in resume ignor this part const corrections = {
        "B": "Ray optics",
        "Duol Natre": "Dual Nature",
        "Radiation and M": "Radiation and Matter",
        "a ffoms": "Atoms",
        "Nuclei 1": "Nuclei",
        "Semiconductor": "Semiconductor"
      };`;
        const prompt3 = `${resume} This is my resume. I am focusing on the job for ${profile}. What are the things I have to improve? These things should not be in the resume or need to be added/learned to make more impact.  Give them in bullet form in 50-70 words.if you see this in resume ignor this part const corrections = {
        "B": "Ray optics",
        "Duol Natre": "Dual Nature",
        "Radiation and M": "Radiation and Matter",
        "a ffoms": "Atoms",
        "Nuclei 1": "Nuclei",
        "Semiconductor": "Semiconductor"
      };`;

        console.log("Prompts sent to AI model:", { prompt1, prompt2, prompt3 }); // Debugging line

        // Get AI responses
        const [scoreResult, goodResult, improveResult] = await Promise.all([
            model.generateContent(prompt1),
            model.generateContent(prompt2),
            model.generateContent(prompt3)
        ]);

        // Extract text from responses
        const scoreText = scoreResult.response?.candidates?.[0]?.content?.parts?.[0]?.text || "No score generated";
        const goodText = goodResult.response?.candidates?.[0]?.content?.parts?.[0]?.text || "No good points generated";
        const improveText = improveResult.response?.candidates?.[0]?.content?.parts?.[0]?.text || "No improvement points generated";

        // Send all feedback
        res.json({
            score: scoreText,
            goodPoints: goodText,
            improvementPoints: improveText
        });

    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});




app.post("/getimage", async (req, res) => {
    const { username } = req.headers;
    if (!username) return res.status(400).json({ error: "Username is required" });
  
    try {
      const userImage = await Image.findOne({ username });
      if (userImage) {
        res.json({ image: userImage.image });
      } else {
        res.json({ image: null });
      }
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  });
  
  app.post("/addimage", async (req, res) => {
    const { username, image } = req.body;
  
    if (!username || !image) {
      return res.status(400).json({ error: "Username and image are required" });
    }
  
    try {
      const existing = await Image.findOne({ username });
  
      if (existing) {
        existing.image = image;
        await existing.save();
        return res.json({ message: "Image updated" });
      } else {
        const newImage = new Image({ username, image });
        await newImage.save();
        return res.json({ message: "Image added" });
      }
    } catch (error) {
      console.error("Error saving image:", error);
      return res.status(500).json({ error: "Server error" });
    }
  });
;
const multer = require('multer');
const { AssemblyAI } = require('assemblyai'); 
const fs = require('fs');
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

const client = new AssemblyAI({
  apiKey: process.env.apiKey,
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const buffer = req.file.buffer;

    const transcript = await client.transcripts.transcribe({
      audio: buffer
    });

    res.json({ text: transcript.text });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).send({ error: err.message });
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
