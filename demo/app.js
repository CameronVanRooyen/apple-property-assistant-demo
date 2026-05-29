const state = {
  listings: [],
  intent: "rent",
  selectedRefs: [],
  lastResults: [],
  includeRetirement: false,
};

const els = {
  listingCount: document.querySelector("#listingCount"),
  filterForm: document.querySelector("#filterForm"),
  areaInput: document.querySelector("#areaInput"),
  budgetInput: document.querySelector("#budgetInput"),
  bedsInput: document.querySelector("#bedsInput"),
  typeInput: document.querySelector("#typeInput"),
  includeRetirement: document.querySelector("#includeRetirement"),
  askForm: document.querySelector("#askForm"),
  askInput: document.querySelector("#askInput"),
  note: document.querySelector("#assistantNote"),
  conversation: document.querySelector("#conversation"),
  results: document.querySelector("#results"),
  clearCompare: document.querySelector("#clearCompare"),
  leadForm: document.querySelector("#leadForm"),
  leadRef: document.querySelector("#leadRef"),
  leadName: document.querySelector("#leadName"),
  leadContact: document.querySelector("#leadContact"),
  leadTime: document.querySelector("#leadTime"),
  leadNotes: document.querySelector("#leadNotes"),
  leadSummary: document.querySelector("#leadSummary"),
  handoffStatus: document.querySelector("#handoffStatus"),
  copyLead: document.querySelector("#copyLead"),
  emailLead: document.querySelector("#emailLead"),
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

function hasExplicitIntent(text) {
  const value = normalise(text);
  return /\b(to rent|rental|rent|let|buy|sale|for sale|purchase|viewing|view|book|appointment|sell|seller|landlord|valuation|list my|letting)\b/.test(value);
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

function addMessage(role, message) {
  if (!els.conversation || !message) {
    return;
  }
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.innerHTML = `<strong>${role === "user" ? "Visitor" : "Assistant"}</strong>${escapeHtml(message)}`;
  els.conversation.append(node);
  els.conversation.scrollTop = els.conversation.scrollHeight;
}

function note(message, options = {}) {
  els.note.textContent = message;
  if (options.log !== false) {
    addMessage("assistant", message);
  }
}

function promptForIntent(intent) {
  setIntent(intent);
  if (intent === "rent") {
    note("Great. Which area should I check first, and what is the maximum monthly rent?");
    renderMessage("Next question", "Ask for area and budget before showing listings.");
    return;
  }
  if (intent === "buy") {
    note("Great. Which city or suburb should I check first, and what purchase budget should I stay under?");
    renderMessage("Next question", "Ask for area and budget before showing listings.");
    return;
  }
  if (intent === "viewing") {
    note("Please send the Web Ref, name, phone or email, and preferred viewing time. The agent should approve the slot before final confirmation.");
    renderMessage("Viewing request", "Use the handoff panel once the visitor supplies the Web Ref and contact details.");
    return;
  }
  if (intent === "sell") {
    note("For a seller or landlord lead, ask for property area, property type, sell/let timeline, name, and phone or email. Do not invent a valuation.");
    renderMessage("Seller or landlord lead", "Prepare a valuation/listing follow-up for a human agent.");
  }
}

function coverageFor(area = "") {
  const query = normalise(area);
  const scoped = query ? state.listings.filter((row) => hasArea(row, query)) : state.listings;
  const current = scoped.filter((row) => !isExcluded(row));
  const rentCities = citySummary(current.filter((row) => row.intent === "rent"));
  const buyCities = citySummary(current.filter((row) => row.intent === "buy"));
  if (query) {
    return `For ${area}, current source data shows rentals in ${rentCities || "no visible rental areas"} and sales in ${buyCities || "no visible sales areas"}. Are you looking to rent or buy, and what budget should I filter by?`;
  }
  return `Current source data is broader than Pretoria East. Rentals are visible in ${rentCities || "no visible rental areas"}. Sales are visible in ${buyCities || "no visible sales areas"}. Are you looking to rent or buy first?`;
}

function citySummary(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = row.city || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([city, count]) => `${city} (${count})`)
    .join(", ");
}

function setIntent(intent) {
  state.intent = intent;
  document.querySelectorAll(".segment-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.intent === intent);
  });
}

function listingByRef(ref) {
  return state.listings.find((row) => row.web_ref.toUpperCase() === String(ref || "").toUpperCase());
}

function searchListings(filters = {}) {
  const intent = filters.intent || state.intent;
  const area = filters.area ?? els.areaInput.value;
  const budget = filters.budget ?? parseMoney(els.budgetInput.value);
  const beds = String(filters.beds ?? els.bedsInput.value).trim();
  const type = normalise(filters.type ?? els.typeInput.value);

  if (intent === "sell") {
    note("I will not invent a valuation. Capture the property area, property type, timeline, name, and phone/email so an agent can follow up.");
    return [];
  }

  if (intent === "viewing") {
    note("For a viewing, capture Web Ref, name, contact details, and preferred time. The agent should approve the slot before the visitor receives final confirmation.");
    return [];
  }

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
    .sort((a, b) => {
      const priceDiff = parseMoney(a.price) - parseMoney(b.price);
      if (priceDiff !== 0) {
        return priceDiff;
      }
      return a.web_ref.localeCompare(b.web_ref);
    });

  state.lastResults = rows.slice(0, 12);
  const budgetLabel = formatBudget(budget, intent);
  const context = [intent === "rent" ? "rentals" : "sales", area, budgetLabel, beds ? `${beds}+ bed` : "", type].filter(Boolean).join(", ");
  if (rows.length) {
    note(`I found ${rows.length} current ${context || "matches"} in the validated Apple Property index. Showing the strongest matches first.`);
  } else {
    const salesOnly = area && state.listings.some((row) => row.intent !== intent && hasArea(row, area));
    if (salesOnly && intent === "rent") {
      note(`I do not see a current rental match for ${area}. The source has sale or sold data there, so I will not present it as available rental stock. Capture the requirement for agent follow-up.`);
    } else {
      note("I do not see an exact current match in the source data. Capture the requirement and pass it to an agent for follow-up.");
    }
  }
  return rows;
}

function renderListings(rows) {
  els.results.innerHTML = "";
  if (!rows.length) {
    els.results.append(emptyState());
    return;
  }

  rows.slice(0, 6).forEach((row) => els.results.append(listingCard(row)));
}

function emptyState() {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.innerHTML = `
    <h2>No exact match visible</h2>
    <p class="muted">Prepare a handoff with the visitor's area, budget, bedrooms, timeline, and contact details.</p>
  `;
  return node;
}

function renderMessage(title, message) {
  els.results.innerHTML = "";
  const node = document.createElement("div");
  node.className = "empty-state";
  node.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <p class="muted">${escapeHtml(message)}</p>
  `;
  els.results.append(node);
}

function listingCard(row) {
  const card = document.createElement("article");
  card.className = "listing-card";
  const wa = whatsappFor(row);
  const tel = telFor(row);
  const available = row.availability || "Not stated";
  const deposit = row.deposit || "Not stated";
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
      <span class="pill">Available ${escapeHtml(available)}</span>
      <span class="pill">Deposit ${escapeHtml(deposit)}</span>
    </div>
    <p class="agent-line">Agent: ${escapeHtml(row.agent || "Not stated")}</p>
    <div class="card-actions">
      <a class="highlight" href="${escapeAttr(row.url)}" target="_blank" rel="noreferrer">Open</a>
      <button type="button" data-action="details" data-ref="${escapeAttr(row.web_ref)}">Details</button>
      <button type="button" data-action="compare" data-ref="${escapeAttr(row.web_ref)}">Compare</button>
      <button type="button" data-action="book" data-ref="${escapeAttr(row.web_ref)}">Book</button>
      ${tel ? `<a href="${escapeAttr(tel)}">Call</a>` : "<span></span>"}
      ${wa ? `<a href="${escapeAttr(wa)}" target="_blank" rel="noreferrer">WhatsApp</a>` : "<span></span>"}
    </div>
  `;
  return card;
}

function renderDetails(ref) {
  const row = listingByRef(ref);
  if (!row || isExcluded(row)) {
    note(`I do not see an available current listing for ${ref} in the validated source data.`);
    renderListings([]);
    return;
  }
  note(`${row.web_ref}: ${row.title}. ${row.price}. ${row.suburb}, ${row.city}. Agent ${row.agent || "not stated"}.`);
  renderListings([row]);
  fillLeadRef(row.web_ref);
}

function renderCompare() {
  const rows = state.selectedRefs.map(listingByRef).filter(Boolean).filter((row) => !isExcluded(row));
  if (rows.length < 2) {
    note("Select two current Web Refs to compare.");
    return;
  }
  const [a, b] = rows.slice(0, 2);
  els.results.innerHTML = "";
  const card = document.createElement("article");
  card.className = "compare-card";
  card.innerHTML = `
    <h2>Compare ${escapeHtml(a.web_ref)} and ${escapeHtml(b.web_ref)}</h2>
    <div class="compare-table">
      ${compareRow("Title", a.title, b.title)}
      ${compareRow("Price", a.price, b.price)}
      ${compareRow("Area", `${a.suburb}, ${a.city}`, `${b.suburb}, ${b.city}`)}
      ${compareRow("Beds/Baths", `${a.beds || "?"} / ${a.baths || "?"}`, `${b.beds || "?"} / ${b.baths || "?"}`)}
      ${compareRow("Available", a.availability || "Not stated", b.availability || "Not stated")}
      ${compareRow("Deposit", a.deposit || "Not stated", b.deposit || "Not stated")}
      ${compareRow("Agent", a.agent || "Not stated", b.agent || "Not stated")}
    </div>
  `;
  els.results.append(card);
  note(`${a.web_ref} and ${b.web_ref} are both current source listings. Choose one to prepare a viewing request.`);
}

function compareRow(label, left, right) {
  return `<div class="compare-row"><span><strong>${escapeHtml(label)}</strong></span><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;
}

function fillLeadRef(ref) {
  els.leadRef.value = ref;
  const row = listingByRef(ref);
  if (row) {
    els.leadNotes.value = listingNote(row);
  }
}

function listingNote(row) {
  return `${row.title}, ${row.price}, ${row.suburb}. Agent: ${row.agent || "not stated"}.`;
}

function prepareLead() {
  const ref = els.leadRef.value.trim().toUpperCase();
  const row = listingByRef(ref);
  let notes = els.leadNotes.value.trim();
  const noteRefs = parseRefs(notes);
  if (row && (!notes || (noteRefs.length && !noteRefs.includes(row.web_ref)))) {
    notes = listingNote(row);
    els.leadNotes.value = notes;
  }
  const summary = [
    "Apple Property lead handoff",
    row ? `Listing: ${row.web_ref} - ${row.title}` : `Listing/Web Ref: ${ref || "Not supplied"}`,
    row ? `Price/area: ${row.price}, ${row.suburb}, ${row.city}` : "",
    row ? `Agent: ${row.agent || "Not stated"} ${firstMobile(row) || ""}`.trim() : "",
    `Visitor: ${els.leadName.value.trim() || "Missing"}`,
    `Contact: ${els.leadContact.value.trim() || "Missing"}`,
    `Preferred time: ${els.leadTime.value.trim() || "Missing"}`,
    `Notes: ${notes || "None"}`,
    "Status: pending agent approval before visitor confirmation",
  ].filter(Boolean).join("\n");
  els.leadSummary.textContent = summary;
  els.leadSummary.classList.add("active");
  els.handoffStatus.textContent = "Ready";
  els.handoffStatus.classList.add("ready");
  els.emailLead.href = `mailto:agent@vanrooyen.tech?subject=${encodeURIComponent(`Apple Property lead ${ref || ""}`)}&body=${encodeURIComponent(summary)}`;
  note("Lead summary prepared. The next operational step is agent approval before confirming the viewing time to the visitor.");
}

function handleAsk(text) {
  const value = normalise(text);
  const refs = parseRefs(text);

  if (value.includes("bond") && value.includes("guarantee")) {
    note("I cannot guarantee bond approval. Approval depends on lender checks and the buyer's financial profile. Offer a human or bond-specialist follow-up.");
    renderListings([]);
    return;
  }

  if (value.includes("not looking for") && (value.includes("retirement") || value.includes("assisted"))) {
    state.includeRetirement = false;
    els.includeRetirement.checked = false;
    note("Retirement and assisted-living listings are now excluded for this conversation.");
  }

  if (value.includes("retirement") && !value.includes("not looking for")) {
    state.includeRetirement = true;
    els.includeRetirement.checked = true;
  }

  if (value.includes("other areas") || value.includes("areas besides") || value.includes("areas do you cover")) {
    note(coverageFor());
    renderMessage("Choose rent or buy", "Select the search intent first, then add area, budget, and bedrooms.");
    return;
  }

  if (refs.length >= 2 || value.startsWith("compare")) {
    state.selectedRefs = refs.slice(0, 2);
    renderCompare();
    return;
  }

  if (refs.length === 1) {
    if (value.includes("book") || value.includes("view")) {
      fillLeadRef(refs[0]);
      setIntent("viewing");
      note(`I can prepare a viewing request for ${refs[0]}. Capture name, contact details, and preferred time, then send it to the agent for approval.`);
      renderDetails(refs[0]);
      return;
    }
    renderDetails(refs[0]);
    return;
  }

  const intent = inferIntent(text);
  setIntent(intent);

  if (intent === "sell") {
    note("For seller or landlord leads, capture property area, property type, sell/let timeline, name, and phone/email. Do not invent a valuation.");
    renderMessage("Seller or landlord lead", "Capture area, property type, timeline, name, and contact details for an agent valuation/listing follow-up.");
    return;
  }

  const area = inferArea(text) || els.areaInput.value;
  const budget = parseMoney(text) || parseMoney(els.budgetInput.value);
  const beds = inferBeds(text) || els.bedsInput.value;
  const type = inferType(text) || els.typeInput.value;

  if (area && !hasExplicitIntent(text) && !budget && !beds && !type) {
    els.areaInput.value = area;
    note(coverageFor(area));
    renderMessage("Choose rent or buy", "Select the search intent first, then add budget and bedrooms for this area.");
    return;
  }

  els.areaInput.value = area;
  els.budgetInput.value = budget ? String(budget) : "";
  els.bedsInput.value = beds;
  els.typeInput.value = [...els.typeInput.options].some((option) => option.value === type) ? type : "";

  const rows = searchListings({ intent, area, budget, beds, type });
  renderListings(rows);
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

function bindEvents() {
  document.querySelectorAll(".segment-button").forEach((button) => {
    button.addEventListener("click", () => {
      addMessage("user", button.textContent.trim());
      promptForIntent(button.dataset.intent);
    });
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt;
      els.askInput.value = prompt;
      addMessage("user", prompt);
      handleAsk(prompt);
      els.askInput.value = "";
    });
  });

  document.querySelectorAll(".area-chips button").forEach((button) => {
    button.addEventListener("click", () => {
      els.areaInput.value = button.dataset.area;
      addMessage("user", button.dataset.area);
      renderListings(searchListings());
    });
  });

  els.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.includeRetirement = els.includeRetirement.checked;
    addMessage("user", `Check ${state.intent} in ${els.areaInput.value || "any area"}`);
    renderListings(searchListings());
  });

  els.includeRetirement.addEventListener("change", () => {
    state.includeRetirement = els.includeRetirement.checked;
    renderListings(searchListings());
  });

  els.askForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.askInput.value.trim();
    if (text) {
      addMessage("user", text);
      handleAsk(text);
      els.askInput.value = "";
    }
  });

  els.results.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }
    const ref = target.dataset.ref;
    if (target.dataset.action === "details") {
      addMessage("user", `Details ${ref}`);
      renderDetails(ref);
    }
    if (target.dataset.action === "book") {
      addMessage("user", `Book viewing ${ref}`);
      fillLeadRef(ref);
      setIntent("viewing");
      note(`Viewing request started for ${ref}. Add name, contact details, and preferred time.`);
    }
    if (target.dataset.action === "compare") {
      addMessage("user", `Compare ${ref}`);
      state.selectedRefs = [...new Set([...state.selectedRefs, ref])].slice(-2);
      renderCompare();
    }
  });

  els.clearCompare.addEventListener("click", () => {
    state.selectedRefs = [];
    renderListings(state.lastResults.length ? state.lastResults : searchListings());
    note("Comparison cleared.");
  });

  els.leadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addMessage("user", "Prepare the lead handoff");
    prepareLead();
  });

  els.leadRef.addEventListener("change", () => {
    const ref = els.leadRef.value.trim().toUpperCase();
    if (listingByRef(ref)) {
      fillLeadRef(ref);
    }
  });

  els.copyLead.addEventListener("click", async () => {
    const text = els.leadSummary.textContent.trim();
    if (!text) {
      note("Prepare a handoff before copying.");
      return;
    }
    await navigator.clipboard.writeText(text);
    note("Lead summary copied.");
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
    note("Hi. I can help qualify a buyer, renter, seller, landlord, or viewing lead. Start with rent, buy, viewing, or sell/let.", { log: false });
    addMessage("assistant", "Hi. I can help qualify a buyer, renter, seller, landlord, or viewing lead. Start with rent, buy, viewing, or sell/let.");
    renderMessage("Waiting for visitor intent", "Choose one of the assistant actions above, or type a natural request such as: rent in Faerie Glen under R8,000.");
  } catch (error) {
    els.listingCount.textContent = "Data error";
    note(error.message);
    renderListings([]);
  }
}

init();
