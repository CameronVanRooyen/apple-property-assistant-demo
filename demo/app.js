const state = {
  listings: [],
  intent: "",
  includeRetirement: false,
  pendingViewingRef: "",
};

const els = {
  listingCount: document.querySelector("#listingCount"),
  conversation: document.querySelector("#conversation"),
  quickReplies: document.querySelector("#quickReplies"),
  askForm: document.querySelector("#askForm"),
  askInput: document.querySelector("#askInput"),
  note: document.querySelector("#assistantNote"),
};

const PRETORIA_EAST = [
  "faerie glen",
  "moreleta park",
  "lynnwood",
  "lynnwood ridge",
  "garsfontein",
  "waterkloof",
  "waterkloof ridge",
  "menlyn",
  "menlyn maine",
  "equestria",
  "silver lakes",
  "olympus",
  "brooklyn",
  "hatfield",
];

const currencyFormatter = new Intl.NumberFormat("en-ZA");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value);
      if (row.some((item) => item.length)) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] || ""])));
}

function normalise(value) {
  return String(value || "").toLowerCase().trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function parseMoney(value) {
  const text = normalise(value).replace(/,/g, "");
  const million = text.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (million) {
    return Math.round(Number(million[1]) * 1000000);
  }
  const number = text.match(/\d+(?:\.\d+)?/);
  return number ? Math.round(Number(number[0])) : 0;
}

function formatBudget(value, intent) {
  if (!value) {
    return "";
  }
  if (intent === "buy" && value >= 1000000) {
    return `R${currencyFormatter.format(value)}`;
  }
  return `R${currencyFormatter.format(value)}${intent === "rent" ? " pm" : ""}`;
}

function parseRefs(text) {
  return [...String(text || "").toUpperCase().matchAll(/\bAP\d+\b/g)].map((match) => match[0]);
}

function inferIntent(text) {
  const value = normalise(text);
  if (/\b(to rent|rental|rent|let)\b/.test(value)) {
    return "rent";
  }
  if (/\b(buy|sale|for sale|purchase)\b/.test(value)) {
    return "buy";
  }
  if (/\b(viewing|view|book|appointment)\b/.test(value)) {
    return "viewing";
  }
  if (/\b(sell|seller|landlord|valuation|list my|letting)\b/.test(value)) {
    return "sell";
  }
  return state.intent;
}

function inferArea(text) {
  const value = normalise(text);
  const known = [
    "pretoria east",
    "centurion",
    "zwartkop",
    "faerie glen",
    "moreleta park",
    "lynnwood ridge",
    "hatfield",
    "menlyn",
    "cornwall hill",
    "pierre van ryneveld",
    "amberfield",
    "waterkloof",
    "brooklyn",
    "fish hoek",
  ];
  return known.find((area) => value.includes(area)) || "";
}

function inferBeds(text) {
  const value = normalise(text);
  const match = value.match(/(\d+(?:\.\d+)?)\s*(bed|bedroom)/);
  return match ? match[1] : "";
}

function inferType(text) {
  const value = normalise(text);
  return ["garden cottage", "townhouse", "apartment", "flat", "house", "freestanding"].find((type) => value.includes(type)) || "";
}

function phoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function phoneToWhatsapp(phone) {
  const digits = phoneDigits(phone);
  if (digits.length === 10 && ["06", "07", "08"].includes(digits.slice(0, 2))) {
    return `https://wa.me/27${digits.slice(1)}`;
  }
  if (digits.length === 11 && digits.startsWith("27")) {
    return `https://wa.me/${digits}`;
  }
  return "";
}

function firstMobile(row) {
  return row.phones.split(";").map((phone) => phone.trim()).find((phone) => phoneToWhatsapp(phone)) || "";
}

function whatsappFor(row) {
  const phone = firstMobile(row);
  const base = phoneToWhatsapp(phone);
  if (!base) {
    return "";
  }
  const text = `Hi, I am interested in ${row.web_ref} - ${row.title}. Is it still available for a viewing?`;
  return `${base}?text=${encodeURIComponent(text)}`;
}

function telFor(row) {
  const phone = firstMobile(row);
  const digits = phoneDigits(phone);
  return digits ? `tel:${digits}` : "";
}

function rowText(row) {
  return normalise([row.title, row.suburb, row.city, row.property_type, row.address, row.web_ref].join(" "));
}

function isExcluded(row) {
  const tags = normalise(row.exclude_tags);
  if (tags.includes("sold") || tags.includes("rented")) {
    return true;
  }
  return !state.includeRetirement && (tags.includes("retirement") || tags.includes("assisted-living"));
}

function hasArea(row, area) {
  const query = normalise(area);
  if (!query) {
    return true;
  }
  const text = rowText(row);
  if (query.includes("pretoria east")) {
    return PRETORIA_EAST.some((suburb) => text.includes(suburb));
  }
  return text.includes(query);
}

function listingByRef(ref) {
  return state.listings.find((row) => row.web_ref.toUpperCase() === String(ref || "").toUpperCase());
}

function addMessage(role, text, child) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  if (text) {
    node.innerHTML = `<p>${escapeHtml(text)}</p>`;
  }
  if (child) {
    node.append(child);
  }
  els.conversation.append(node);
  els.conversation.scrollTop = els.conversation.scrollHeight;
  if (role === "assistant" || role === "system") {
    els.note.textContent = text || "Response shown";
  }
}

function setQuickReplies(replies) {
  els.quickReplies.innerHTML = "";
  replies.forEach((reply) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = reply.label;
    button.dataset.prompt = reply.prompt;
    els.quickReplies.append(button);
  });
}

function defaultReplies() {
  setQuickReplies([
    { label: "Rent", prompt: "I want to rent" },
    { label: "Buy", prompt: "I want to buy" },
    { label: "Book viewing", prompt: "Book a viewing for AP17545" },
    { label: "Sell/let", prompt: "I want to sell my property" },
  ]);
}

function citySummary(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = row.city || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([city, count]) => `${city} (${count})`)
    .join(", ");
}

function coverageFor(area = "") {
  const query = normalise(area);
  const scoped = query ? state.listings.filter((row) => hasArea(row, query)) : state.listings;
  const current = scoped.filter((row) => !isExcluded(row));
  const rentCities = citySummary(current.filter((row) => row.intent === "rent"));
  const buyCities = citySummary(current.filter((row) => row.intent === "buy"));
  if (query) {
    return `For ${area}, I can see rentals in ${rentCities || "no visible rental areas"} and sales in ${buyCities || "no visible sales areas"}. Are you looking to rent or buy there?`;
  }
  return `The source is broader than Pretoria East. Rentals are visible in ${rentCities || "no visible rental areas"}. Sales are visible in ${buyCities || "no visible sales areas"}. Are you looking to rent or buy first?`;
}

function searchListings({ intent, area, budget, beds, type }) {
  const rows = state.listings
    .filter((row) => row.intent === intent)
    .filter((row) => !isExcluded(row))
    .filter((row) => hasArea(row, area))
    .filter((row) => {
      if (!budget) {
        return true;
      }
      const price = parseMoney(row.price);
      return price > 0 && price <= budget;
    })
    .filter((row) => {
      if (!beds) {
        return true;
      }
      return Number(row.beds) >= Number(beds);
    })
    .filter((row) => {
      if (!type) {
        return true;
      }
      return rowText(row).includes(type);
    })
    .sort((a, b) => parseMoney(a.price) - parseMoney(b.price));
  return rows;
}

function listingCard(row) {
  const card = document.createElement("div");
  card.className = "listing-card";
  const wa = whatsappFor(row);
  const tel = telFor(row);
  card.innerHTML = `
    <div class="listing-head">
      <h2 class="listing-title">${escapeHtml(row.title)}</h2>
      <span class="web-ref">${escapeHtml(row.web_ref)}</span>
    </div>
    <p class="price">${escapeHtml(row.price)}</p>
    <p class="muted">${escapeHtml(row.suburb)}, ${escapeHtml(row.city)}</p>
    <div class="pill-row">
      <span class="pill">${escapeHtml(row.beds || "?")} bed</span>
      <span class="pill">${escapeHtml(row.baths || "?")} bath</span>
      <span class="pill">Available ${escapeHtml(row.availability || "Not stated")}</span>
      ${row.deposit ? `<span class="pill">Deposit ${escapeHtml(row.deposit)}</span>` : ""}
    </div>
    <p class="agent-line">Agent: ${escapeHtml(row.agent || "Not stated")}</p>
    <div class="listing-actions">
      <a class="primary" href="${escapeAttr(row.url)}" target="_blank" rel="noreferrer">Open</a>
      <button type="button" data-action="details" data-ref="${escapeAttr(row.web_ref)}">Details</button>
      <button type="button" data-action="book" data-ref="${escapeAttr(row.web_ref)}">Book</button>
      ${tel ? `<a href="${escapeAttr(tel)}">Call</a>` : ""}
      ${wa ? `<a href="${escapeAttr(wa)}" target="_blank" rel="noreferrer">WhatsApp</a>` : ""}
    </div>
  `;
  return card;
}

function showListings(rows, context) {
  if (!rows.length) {
    const message = context.salesOnly
      ? `I do not see a current rental match for ${context.area}. The source has sale or sold data there, so I will not present it as available rental stock. I can still prepare a requirement for agent follow-up.`
      : "I do not see an exact current match in the source data. I can still prepare the requirement for an agent to follow up.";
    addMessage("assistant", message);
    setQuickReplies([
      { label: "Send to agent", prompt: `Please pass this ${context.intent || "property"} requirement to an agent` },
      { label: "Try Pretoria East", prompt: "I want to rent in Pretoria East under R8000" },
      { label: "Try Centurion", prompt: "I want to buy in Centurion under R2m" },
    ]);
    return;
  }

  const stack = document.createElement("div");
  stack.className = "listing-stack";
  rows.slice(0, 3).forEach((row) => stack.append(listingCard(row)));
  const intro = `I found ${rows.length} current ${context.intent === "rent" ? "rental" : "sale"} match${rows.length === 1 ? "" : "es"}. Here are the best options from the source data.`;
  addMessage("assistant", intro, stack);

  const replies = [
    { label: `Book ${rows[0].web_ref}`, prompt: `Book a viewing for ${rows[0].web_ref}` },
    { label: `Details ${rows[0].web_ref}`, prompt: `Tell me more about ${rows[0].web_ref}` },
  ];
  if (rows[1]) {
    replies.push({ label: "Compare first two", prompt: `Compare ${rows[0].web_ref} and ${rows[1].web_ref}` });
  }
  replies.push({ label: "Refine search", prompt: `${context.intent} in ${context.area || "Pretoria East"} under ${context.budget ? formatBudget(context.budget, context.intent) : "R8000"}` });
  setQuickReplies(replies);
}

function showDetails(ref) {
  const row = listingByRef(ref);
  if (!row || isExcluded(row)) {
    addMessage("assistant", `I do not see an available current listing for ${ref} in the validated source data.`);
    return;
  }
  addMessage("assistant", `${row.web_ref}: ${row.title}. ${row.price}. ${row.suburb}, ${row.city}. Agent ${row.agent || "not stated"}.`, listingCard(row));
  setQuickReplies([
    { label: `Book ${row.web_ref}`, prompt: `Book a viewing for ${row.web_ref}` },
    { label: "WhatsApp agent", prompt: `I want to contact the agent for ${row.web_ref}` },
    { label: "New search", prompt: "I want to rent" },
  ]);
}

function showCompare(refs) {
  const rows = refs.map(listingByRef).filter(Boolean).filter((row) => !isExcluded(row));
  if (rows.length < 2) {
    addMessage("assistant", "I need two current Web Refs to compare.");
    return;
  }
  const [a, b] = rows;
  const card = document.createElement("div");
  card.className = "compare-card";
  card.innerHTML = `
    <div class="compare-grid">
      ${compareRow("Price", a.price, b.price)}
      ${compareRow("Area", `${a.suburb}, ${a.city}`, `${b.suburb}, ${b.city}`)}
      ${compareRow("Beds", `${a.beds || "?"} bed`, `${b.beds || "?"} bed`)}
      ${compareRow("Available", a.availability || "Not stated", b.availability || "Not stated")}
      ${compareRow("Agent", a.agent || "Not stated", b.agent || "Not stated")}
    </div>
  `;
  addMessage("assistant", `${a.web_ref} and ${b.web_ref} compared side by side.`, card);
  setQuickReplies([
    { label: `Book ${a.web_ref}`, prompt: `Book a viewing for ${a.web_ref}` },
    { label: `Book ${b.web_ref}`, prompt: `Book a viewing for ${b.web_ref}` },
    { label: "New search", prompt: "I want to rent" },
  ]);
}

function compareRow(label, left, right) {
  return `<div class="compare-row"><span><strong>${escapeHtml(label)}</strong></span><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;
}

function parseLead(text) {
  const nameMatch = text.match(/(?:my name is|i am|i'm)\s+([a-z][a-z\s'-]{1,40})(?:\s+and|\s*,|$)/i);
  const phoneMatch = text.match(/\b0\d{2}\s?\d{3}\s?\d{4}\b/);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const timeMatch = text.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(morning|afternoon|evening))?\b/i);
  return {
    name: nameMatch ? nameMatch[1].trim() : "",
    contact: phoneMatch ? phoneMatch[0] : (emailMatch ? emailMatch[0] : ""),
    time: timeMatch ? timeMatch[0] : "",
  };
}

function showViewingRequest(ref, sourceText = "") {
  const row = listingByRef(ref);
  if (!row || isExcluded(row)) {
    addMessage("assistant", `I do not see current available details for ${ref}. I can still ask an agent to follow up if you provide contact details.`);
    return;
  }
  state.pendingViewingRef = row.web_ref;
  const lead = parseLead(sourceText);
  if (lead.name && lead.contact && lead.time) {
    showHandoff(row, lead);
    return;
  }
  addMessage("assistant", `I can request a viewing for ${row.web_ref}. Please send the visitor name, phone or email, and preferred viewing time. I will mark it as pending agent approval.`);
  setQuickReplies([
    { label: "Example details", prompt: `My name is Cameron and my phone is 082 123 4567. Tomorrow afternoon for ${row.web_ref}` },
    { label: `Details ${row.web_ref}`, prompt: `Tell me more about ${row.web_ref}` },
    { label: "New search", prompt: "I want to rent" },
  ]);
}

function showHandoff(row, lead) {
  const summary = [
    `Listing: ${row.web_ref} - ${row.title}`,
    `Price/area: ${row.price}, ${row.suburb}, ${row.city}`,
    `Agent: ${row.agent || "Not stated"} ${firstMobile(row) || ""}`.trim(),
    `Visitor: ${lead.name || "Missing"}`,
    `Contact: ${lead.contact || "Missing"}`,
    `Preferred time: ${lead.time || "Missing"}`,
    "Status: pending agent approval before visitor confirmation",
  ].join("\n");
  const card = document.createElement("div");
  card.className = "handoff-card";
  card.innerHTML = `
    <strong>Viewing request ready for handoff</strong>
    <pre>${escapeHtml(summary)}</pre>
    <div class="handoff-actions">
      <button type="button" data-action="copy" data-summary="${escapeAttr(summary)}">Copy</button>
      <a class="primary" href="mailto:agent@vanrooyen.tech?subject=${encodeURIComponent(`Apple Property lead ${row.web_ref}`)}&body=${encodeURIComponent(summary)}">Email</a>
    </div>
  `;
  addMessage("assistant", "I have the viewing request details. The next step is agent approval before confirming the slot to the visitor.", card);
  setQuickReplies([
    { label: "Another viewing", prompt: "Book a viewing for AP21733" },
    { label: "New rental search", prompt: "I want to rent in Pretoria East under R8000" },
    { label: "Seller lead", prompt: "I want to sell my property" },
  ]);
}

function showSellerFlow() {
  addMessage("assistant", "I can prepare a seller or landlord lead, but I will not invent a valuation. Please collect property area, property type, sell or let timeline, name, and phone or email.");
  setQuickReplies([
    { label: "Pretoria East house", prompt: "House in Pretoria East, selling in 3 months, Cameron, 082 123 4567" },
    { label: "Landlord lead", prompt: "I want to let out my apartment in Hatfield" },
    { label: "Back to listings", prompt: "I want to rent" },
  ]);
}

function handlePrompt(text) {
  const value = normalise(text);
  const refs = parseRefs(text);

  if (value.includes("bond") && value.includes("guarantee")) {
    addMessage("assistant", "I cannot guarantee bond approval. Approval depends on lender checks and the buyer's financial profile. I can offer a human or bond-specialist follow-up.");
    return;
  }

  if (value.includes("not looking for") && (value.includes("retirement") || value.includes("assisted"))) {
    state.includeRetirement = false;
    addMessage("assistant", "Understood. I will exclude retirement and assisted-living listings from this conversation.");
    return;
  }

  if (value.includes("retirement") && !value.includes("not looking for")) {
    state.includeRetirement = true;
  }

  if (value.includes("other areas") || value.includes("areas besides") || value.includes("areas do you cover")) {
    addMessage("assistant", coverageFor());
    setQuickReplies([
      { label: "Rent Pretoria", prompt: "I want to rent in Pretoria under R10000" },
      { label: "Buy Centurion", prompt: "I want to buy in Centurion under R2m" },
      { label: "Book viewing", prompt: "Book a viewing for AP17545" },
    ]);
    return;
  }

  if ((value.includes("book") || value.includes("viewing") || value.includes("view")) && refs[0]) {
    showViewingRequest(refs[0], text);
    return;
  }

  if (state.pendingViewingRef && (value.includes("phone") || /\b0\d{2}\s?\d{3}\s?\d{4}\b/.test(value))) {
    const row = listingByRef(state.pendingViewingRef);
    if (row) {
      showHandoff(row, parseLead(text));
      return;
    }
  }

  if (refs.length >= 2 || value.startsWith("compare")) {
    showCompare(refs);
    return;
  }

  if (refs.length === 1) {
    showDetails(refs[0]);
    return;
  }

  const intent = inferIntent(text);
  if (intent === "sell") {
    state.intent = "sell";
    showSellerFlow();
    return;
  }

  if (intent === "viewing") {
    state.intent = "viewing";
    addMessage("assistant", "Please send the Web Ref for the property, plus the visitor name, contact details, and preferred viewing time.");
    return;
  }

  if (intent === "rent" || intent === "buy") {
    state.intent = intent;
    const area = inferArea(text);
    const budget = parseMoney(text);
    const beds = inferBeds(text);
    const type = inferType(text);

    if (!area) {
      addMessage("assistant", intent === "rent" ? "Which area should I check first, and what is the maximum monthly rent?" : "Which city or suburb should I check first, and what purchase budget should I stay under?");
      setQuickReplies([
        { label: "Pretoria East", prompt: `${intent} in Pretoria East under ${intent === "rent" ? "R8000" : "R2m"}` },
        { label: "Centurion", prompt: `${intent} in Centurion under ${intent === "rent" ? "R10000" : "R2m"}` },
        { label: "Hatfield", prompt: `${intent} in Hatfield under ${intent === "rent" ? "R9000" : "R1m"}` },
      ]);
      return;
    }

    if (!budget && !beds && !type && !/\bunder\b/.test(value)) {
      addMessage("assistant", coverageFor(area));
      setQuickReplies([
        { label: "Rent there", prompt: `rent in ${area} under R10000` },
        { label: "Buy there", prompt: `buy in ${area} under R2m` },
        { label: "Different area", prompt: "Any other areas besides Pretoria east?" },
      ]);
      return;
    }

    const rows = searchListings({ intent, area, budget, beds, type });
    const salesOnly = area && intent === "rent" && state.listings.some((row) => row.intent !== "rent" && hasArea(row, area));
    showListings(rows, { intent, area, budget, beds, type, salesOnly });
    return;
  }

  addMessage("assistant", "I can help with renting, buying, booking a viewing, or seller/landlord follow-up. Which one should we start with?");
  defaultReplies();
}

function bindEvents() {
  els.askForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.askInput.value.trim();
    if (!text) {
      return;
    }
    addMessage("user", text);
    els.askInput.value = "";
    handlePrompt(text);
  });

  els.quickReplies.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (!button) {
      return;
    }
    const prompt = button.dataset.prompt;
    addMessage("user", prompt);
    handlePrompt(prompt);
  });

  els.conversation.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) {
      return;
    }
    if (action.dataset.action === "details") {
      addMessage("user", `Tell me more about ${action.dataset.ref}`);
      showDetails(action.dataset.ref);
    }
    if (action.dataset.action === "book") {
      addMessage("user", `Book a viewing for ${action.dataset.ref}`);
      showViewingRequest(action.dataset.ref);
    }
    if (action.dataset.action === "copy") {
      await navigator.clipboard.writeText(action.dataset.summary || "");
      addMessage("system", "Lead summary copied.");
    }
  });
}

async function init() {
  bindEvents();
  try {
    const response = await fetch("data/listing-index.csv");
    if (!response.ok) {
      throw new Error(`Could not load listing index: ${response.status}`);
    }
    const text = await response.text();
    state.listings = parseCsv(text).map((row) => ({ ...row, web_ref: row.web_ref.toUpperCase() }));
    els.listingCount.textContent = `${state.listings.length} listings`;
    addMessage("assistant", "Hi - I can help you find Apple Property listings, book a viewing, contact an agent, or request a seller/landlord valuation. Are you looking to rent, buy, sell/list, or book a viewing?");
    defaultReplies();
  } catch (error) {
    els.listingCount.textContent = "Data error";
    addMessage("assistant", error.message);
  }
}

init();
