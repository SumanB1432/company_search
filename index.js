const express = require("express")
require("dotenv").config();
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
let GEMINI_API_KEY = "";


const app = express()
app.use(express.json());
app.use(cors());


function extractJsonBlock(text) {
    // Try to find the first match of triple-backtick fenced code with "json"
    const match = text.match(/```json([\s\S]*?)```/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return null;
}

// ------------------ PERPLEXITY API CALL ------------------
async function fetchJobListings(promptText) {
    try {
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.PER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "sonar-reasoning-pro",
                messages: [
                    { role: "system", content: "You are a specialized job search assistant." },
                    { role: "user", content: promptText }
                ]
            }),
        });

        console.log(response);
        const result = await response.json();
        const rawText = result?.choices?.[0]?.message?.content || "";
        console.log("📩 Perplexity Raw Response:", rawText);
        return rawText; // Return just the text portion
    } catch (error) {
        console.error("❌ Error in fetchJobListings:", error);
        return null;
    }
}

// ------------------ GEMINI API CALL ------------------



async function fetchGeminiResponse(inputText) {
    try {
        // Craft a strong system instruction to produce only JSON in a triple-backtick code block
        const systemPrompt = `
        You are a strict JSON output generator. 
        You receive some text and must respond ONLY with valid JSON enclosed in triple backticks 
        (like \`\`\`json ... \`\`\`). 
        Outside of the triple backticks, do not provide any additional explanation.
        Example: {"Company Name": "Example Co", "Recruiter Email": "hr@example.co"}
      `;

        const userPrompt = `
        ${inputText}
      `;

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const chat = model.startChat({ messages: [{ author: "system", content: systemPrompt }] });

        // Send the user's message to Gemini
        const result = await chat.sendMessage(userPrompt);

        // The response is a streaming object; we get the final text
        const textResponse = await result.response.text();
        // console.log("🔄 Gemini Raw Response:", textResponse);
        return textResponse;
    } catch (error) {
        console.error("❌ Error in fetchGeminiResponse:", error);
        return null;
    }
}
function extractEmailsAndDomains(text) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailRegex) || [];

    const results = emails.map(email => {
        return {

            company_name: email.split('@')[1],
            recruiter_email: email,
        };
    });

    return results;
}

// Example usage
// const text = `<think>
// Okay, let's tackle this query. The user wants a list of 20 remote Python Developer jobs with 2-5 years of experience, each including company name and recruiter email...
// </think>

// json
// [
//   {"company_name": "Phoenix Cyber", "recruiter_email": "careers@phoenixcyber.com"},
//   {"company_name": "D-Tech", "recruiter_email": "hr@d-tech.com"},
//   {"company_name": "The Wolf Works LLC", "recruiter_email": "jobs@wolfworksllc.com"},
//   {"company_name": "Tactibit Technologies LLC", "recruiter_email": "recruiting@tactibit.com"},
//   {"company_name": "Accenture Federal Services", "recruiter_email": "afs.recruitment@accenturefederal.com"},
//   {"company_name": "ZeroTrusted.AI", "recruiter_email": "careers@zerotrusted.ai"},
//   {"company_name": "Groundswell", "recruiter_email": "talent@groundswell.io"},
//   {"company_name": "ICF", "recruiter_email": "icfcareers@icf.com"},
//   {"company_name": "Crossover", "recruiter_email": "apply@crossover.com"},
//   {"company_name": "LookFar Labs", "recruiter_email": "jobs@lookfarlabs.com"},
//   {"company_name": "Collabera", "recruiter_email": "collabera.hr@collabera.com"},
//   {"company_name": "Swappa LLC", "recruiter_email": "careers@swappa.com"},
//   {"company_name": "Spotter", "recruiter_email": "joinus@spotter.com"},
//   {"company_name": "Resource Informatics Group", "recruiter_email": "rig.hr@rigus.com"},
//   {"company_name": "DevSelect", "recruiter_email": "jobs@devselect.io"},
//   {"company_name": "84 Lumber", "recruiter_email": "hr@84lumber.com"},
//   {"company_name": "Kasmo Global", "recruiter_email": "recruitment@kasmoglobal.com"},
//   {"company_name": "C4 Technical Services", "recruiter_email": "careers@c4technical.com"},
//   {"company_name": "DataAnnotation", "recruiter_email": "talent@dataannotation.tech"},
//   {"company_name": "Premise Health", "recruiter_email": "premise.careers@premisehealth.com"}
// ]
// `;

// const result = extractEmailsAndDomains(text);
// console.log("Extracted Data:", JSON.stringify(result, null, 2));

// ------------------ MAIN LOGIC (ONE ITERATION) ------------------
async function main(jobTitle, location, experience) {

    // Build the prompt for Perplexity
    const basePrompt = `
      List 20 job openings for the position of ${jobTitle} in ${location} with ${experience} year of experience from today. 
      Each job listing must include:
      - company_name (Required. If unavailable, use the company's domain name in red.)
      - recruiter_email (Required, do NOT omit email. Use the official company HR email if needed.)
  
      ⚠️ IMPORTANT:
      - [
        {"company_name": "Example Co", "recruiter_email": "hr@example.co"},
        ...
        ] 
      - Every job listing MUST contain an email from the company's website.
      - If the recruiter email is unavailable, use the official HR email.
      - DO NOT return jobs without an email.
      - Return only a JSON array with no extra text.
    `;

    // 1) Call Perplexity API to get the raw job listings text
    const perplexityText = await fetchJobListings(basePrompt);
    if (!perplexityText) {
        console.log("No response from Perplexity. Stopping.");
        return;
    }
    const result = extractEmailsAndDomains(perplexityText);

    // 2) Pass the Perplexity text to Gemini to convert it into strictly valid JSON
    const geminiPrompt = `
        You are a strict JSON output generator. 
        You receive some text from Perplexity. 
        You must respond ONLY with valid JSON enclosed in triple backticks 
        (like \`\`\`json ... \`\`\`). 
        Outside of the triple backticks, do not provide any additional explanation. 
        Return an array of objects in this format: 
        [
        {"company_name": "Example Co", "recruiter_email": "hr@example.co"},
        ...
        ] 
        No duplicates, no extraneous text.
        ${perplexityText}
    `;

    const geminiText = await fetchGeminiResponse(geminiPrompt);

    // if (!geminiText) {
    //     console.log("No response from Gemini. Stopping.");
    //     return;
    // }

    // 3) Extract and parse the JSON block from the Gemini response
    let jobListings = [];
    const jsonBlock = extractJsonBlock(geminiText);
    if (jsonBlock) {
        try {
            jobListings = JSON.parse(jsonBlock);
            // console.log("✅ Final JSON output:\n", JSON.stringify(jobListings, null, 2));
        } catch (err) {
            console.error("❌ JSON.parse error:", err);
        }
    } else {
        try {
            jobListings = JSON.parse(result)
        }
        catch {
            console.error("❌ JSON.parse error:");
        }
    }

    return jobListings;
}

const jobTitle = "Software Developer";

// ------------------ RUN THE PROCESS ------------------
app.get("/",(req,res)=>{
    return res.status(200).send({message:"Company Search "})
})

app.post("/job_search", (req, res) => {
    const { jobTitle, location, experience, geminiKey } = req.body;
    if (!jobTitle) {
        return res.status(400).send({ message: "Job Title is required" })
    }
    if (!location) {
        return res.status(400).send({ message: "Location is required" })
    }
    if (!experience) {
        return res.status(400).send({ message: "Experience is required" })
    }
    if (!geminiKey) {
        return res.status(400).send({ message: "Gemini key not found" })
    }
    else {
        GEMINI_API_KEY = geminiKey;
    }
    main(jobTitle, location, experience).then((output) => {
        // console.log("\n✅ Process Completed. Final JSON output:\n", output);
        return res.status(200).send({ messgae: "OK", data: output })
    });

})

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));