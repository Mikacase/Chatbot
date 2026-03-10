import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BOOKING_LINK =
  "https://book.servicem8.com/request_service_online_booking?strVendorUUID=ee625934-fc93-4244-a9a2-218fd1923f7b#9b9e5306-c45d-404f-bc4b-221306b5df4b";

const BUSINESS_PHONE = "(747) 207-2030";
const BUSINESS_PHONE_LINK = "tel:+17472072030";
const BUSINESS_SMS_LINK = "sms:+17472072030";
const LEAD_EMAIL = "ayappliances@gmail.com";

const SERVICE_AREAS = [
  "azusa",
  "beverly hills",
  "burbank",
  "calabasas",
  "camarillo",
  "encino",
  "glendale",
  "hidden hills",
  "hollywood",
  "la canada",
  "los angeles",
  "los feliz",
  "malibu",
  "north hollywood",
  "pacific palisades",
  "pasadena",
  "santa clarita",
  "santa monica",
  "sherman oaks",
  "sierra madre",
  "studio city",
  "thousand oaks",
  "van nuys",
  "west hollywood",
  "woodland hills",
];

function isLikelyInServiceArea(location = "") {
  const value = String(location).toLowerCase();
  return SERVICE_AREAS.some((city) => value.includes(city));
}

const systemPrompt = `
You are the website chatbot for A&Y Appliances.

Business facts:
- Business name: A&Y Appliances
- Phone: ${BUSINESS_PHONE}
- Booking link: ${BOOKING_LINK}
- Service fee: $85 for the first appliance diagnostic, $50 for each additional appliance diagnostic, waived if hired
- Service area includes Camarillo to Azusa, including Malibu, Santa Monica, West Hollywood, Beverly Hills, Santa Clarita, Glendale, Burbank, Pasadena, Los Feliz, Sierra Madre, and nearby areas
- Microwave service is only for over-the-range, built-in, or combination wall oven microwave units
- Do not offer countertop microwave repair

Your job:
- Qualify appliance repair leads
- Ask one short question at a time
- Keep replies short
- Collect these fields when possible:
  appliance_type, brand, issue, city, zip_code, model_number, name, phone, email, address, preferred_time
- If customer asks price, tell them the service fee exactly
- If the lead looks good, direct them to book online, call, or text photos and model number
- Never invent appointment times
- Never claim a technician is available unless the customer is being handed off to the office
- If location seems outside the service area, say the office needs to confirm coverage
- If the issue is unclear, ask for model number and symptom
- End with a clear next step
`;

function extractLeadFields(historyText) {
  const lead = {
    name: "",
    phone: "",
    email: "",
    appliance_type: "",
    brand: "",
    issue: "",
    city: "",
    zip_code: "",
    model_number: "",
    address: "",
    preferred_time: "",
  };

  const lines = historyText.split("\n");

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (!lead.email) {
      const emailMatch = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (emailMatch) lead.email = emailMatch[0];
    }

    if (!lead.phone) {
      const phoneMatch = line.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
      if (phoneMatch) lead.phone = phoneMatch[0];
    }

    if (!lead.appliance_type) {
      const appliances = [
        "refrigerator",
        "fridge",
        "freezer",
        "washer",
        "dryer",
        "dishwasher",
        "oven",
        "range",
        "cooktop",
        "microwave",
        "ice maker",
        "wine cooler",
      ];
      const hit = appliances.find((a) => lower.includes(a));
      if (hit) lead.appliance_type = hit;
    }

    if (!lead.brand) {
      const brands = [
        "sub-zero",
        "wolf",
        "thermador",
        "viking",
        "miele",
        "lg",
        "samsung",
        "ge",
        "whirlpool",
        "kitchenaid",
        "bosch",
        "maytag",
        "frigidaire",
        "dacor",
        "monogram",
        "jennair",
        "fisher paykel",
      ];
      const hit = brands.find((b) => lower.includes(b));
      if (hit) lead.brand = hit;
    }

    if (!lead.city) {
      const hit = SERVICE_AREAS.find((city) => lower.includes(city));
      if (hit) lead.city = hit;
    }

    if (!lead.zip_code) {
      const zipMatch = line.match(/\b\d{5}\b/);
      if (zipMatch) lead.zip_code = zipMatch[0];
    }

    if (!lead.model_number) {
      const modelMatch = line.match(/\b[A-Z0-9-]{5,}\b/i);
      if (modelMatch) lead.model_number = modelMatch[0];
    }
  }

  return lead;
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

app.get("/", (req, res) => {
  res.json({ ok: true, message: "A&Y chatbot backend is running." });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const input = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    const response = await client.responses.create({
      model: "gpt-5",
      input,
    });

    const reply =
      response.output_text ||
      "Please share the appliance type, brand, and your city.";

    res.json({
      reply,
      actions: {
        booking_link: BOOKING_LINK,
        call_link: BUSINESS_PHONE_LINK,
        sms_link: BUSINESS_SMS_LINK,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      reply:
        "Sorry, something went wrong. Please call, text, or book online and our office will help you.",
    });
  }
});

app.post("/api/lead", async (req, res) => {
  try {
    const { transcript = [], page_url = "", source = "website_chat" } = req.body;

    const historyText = transcript
      .map((item) => `${item.role}: ${item.content}`)
      .join("\n");

    const lead = extractLeadFields(historyText);
    const serviceAreaMatch = isLikelyInServiceArea(
      `${lead.city} ${lead.zip_code} ${lead.address}`
    );

    const subject = `New A&Y Website Chat Lead${lead.name ? `, ${lead.name}` : ""}`;

    const html = `
      <h2>New Website Chat Lead</h2>
      <p><strong>Name:</strong> ${lead.name || ""}</p>
      <p><strong>Phone:</strong> ${lead.phone || ""}</p>
      <p><strong>Email:</strong> ${lead.email || ""}</p>
      <p><strong>Appliance:</strong> ${lead.appliance_type || ""}</p>
      <p><strong>Brand:</strong> ${lead.brand || ""}</p>
      <p><strong>Issue:</strong> ${lead.issue || ""}</p>
      <p><strong>City:</strong> ${lead.city || ""}</p>
      <p><strong>ZIP:</strong> ${lead.zip_code || ""}</p>
      <p><strong>Model:</strong> ${lead.model_number || ""}</p>
      <p><strong>Address:</strong> ${lead.address || ""}</p>
      <p><strong>Preferred time:</strong> ${lead.preferred_time || ""}</p>
      <p><strong>Service area match:</strong> ${serviceAreaMatch ? "Yes" : "Needs review"}</p>
      <p><strong>Source:</strong> ${source}</p>
      <p><strong>Page URL:</strong> ${page_url}</p>
      <hr />
      <pre>${historyText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      <hr />
      <p><a href="${BOOKING_LINK}">Open ServiceM8 Booking</a></p>
    `;

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: LEAD_EMAIL,
      subject,
      html,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Lead error:", error);
    res.status(500).json({ ok: false });
  }
});

app.listen(port, () => {
  console.log(`A&Y chatbot backend running on port ${port}`);
});
