const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { Octokit } = require("@octokit/rest");
const {
	SlashCommandBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	EmbedBuilder,
	Events,
} = require("discord.js");

// ----------------- CONFIG -----------------
const RAFFLE_CHANNEL_ID = "1451571418138673215";
const RAFFLE_CHANNEL_NAME = "⭐monthly-raffle-tickets⭐";
const DATA_FILE = path.join(__dirname, "tix.json");
const EST_TZ = "America/New_York";
const GITHUB_OWNER = process.env.RAFFLE_GITHUB_OWNER || null;
const GITHUB_REPO = process.env.RAFFLE_GITHUB_REPO || null;
const GITHUB_PATH = process.env.RAFFLE_GITHUB_PATH || "tix.json";
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// ----------------- LOAD TICKETS -----------------
let tix = [];
if (fs.existsSync(DATA_FILE)) {
	try {
		const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
		tix = raw ? JSON.parse(raw) : [];
	} catch (err) {
		console.error("Failed to parse tix.json, resetting file:", err);
		tix = [];
		fs.writeFileSync(DATA_FILE, JSON.stringify(tix, null, 2));
	}
} else {
	fs.writeFileSync(DATA_FILE, JSON.stringify(tix, null, 2));
}

function saveTix() {
	fs.writeFileSync(DATA_FILE, JSON.stringify(tix, null, 2));
}

async function updateTixOnGitHub() {
	if (!GITHUB_OWNER || !GITHUB_REPO || !process.env.GITHUB_TOKEN) return;
	try {
		const { data: fileData } = await octokit.repos.getContent({
			owner: GITHUB_OWNER,
			repo: GITHUB_REPO,
			path: GITHUB_PATH,
		});

		const content = Buffer.from(JSON.stringify(tix, null, 2)).toString("base64");

		await octokit.repos.createOrUpdateFileContents({
			owner: GITHUB_OWNER,
			repo: GITHUB_REPO,
			path: GITHUB_PATH,
			message: "Update tix.json",
			content,
			sha: fileData.sha,
		});
	} catch (err) {
		console.error("Failed to sync tix.json to GitHub:", err);
	}
}

async function loadTixFromGitHub() {
	if (!GITHUB_OWNER || !GITHUB_REPO || !process.env.GITHUB_TOKEN) return;
	try {
		const { data: fileData } = await octokit.repos.getContent({
			owner: GITHUB_OWNER,
			repo: GITHUB_REPO,
			path: GITHUB_PATH,
		});

		const content = Buffer.from(fileData.content, "base64").toString("utf8");
		const parsed = content.trim() ? JSON.parse(content) : [];
		if (Array.isArray(parsed)) {
			tix = parsed;
			fs.writeFileSync(DATA_FILE, JSON.stringify(tix, null, 2));
		}
	} catch (err) {
		console.error("Failed to load tix.json from GitHub:", err);
	}
}

let tixReady = Promise.resolve();
if (GITHUB_OWNER && GITHUB_REPO && process.env.GITHUB_TOKEN) {
	tixReady = loadTixFromGitHub();
}

function getEstParts(date) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: EST_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
	};
}

function getEstYearMonth(date) {
	const { year, month } = getEstParts(date);
	return `${year}-${String(month).padStart(2, "0")}`;
}

function getPrevEstYearMonth(date) {
	const { year, month } = getEstParts(date);
	if (month === 1) return { year: year - 1, month: 12 };
	return { year, month: month - 1 };
}

function formatMonthYear(year, month) {
	// Use mid-month at noon UTC to avoid timezone rollover to previous month
	const d = new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
	return new Intl.DateTimeFormat("en-US", {
		timeZone: EST_TZ,
		month: "long",
		year: "numeric",
	}).format(d);
}

function normalizeChannelName(name) {
	return name?.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

async function findChannel(guild, { id, name, normalizedTarget }) {
	if (!guild) return null;

	if (id) {
		const byId = await guild.channels.fetch(id).catch(() => null);
		if (byId) return byId;
	}

	if (name) {
		const byName = guild.channels.cache.find((ch) => ch.name === name);
		if (byName) return byName;
	}

	if (normalizedTarget) {
		const byNormalized = guild.channels.cache.find(
			(ch) => normalizeChannelName(ch.name) === normalizedTarget
		);
		if (byNormalized) return byNormalized;
	}

	return null;
}

// ----------------- MODULE EXPORT -----------------
module.exports = (client) => {
	// ----------------- REGISTER SLASH COMMANDS -----------------
	client.once(Events.ClientReady, async () => {
		try {
			const existing = await client.application.commands.fetch();
			if (!existing.some((cmd) => cmd.name === "submittix")) {
				const command = new SlashCommandBuilder()
					.setName("submittix")
					.setDescription("Submit raffle tickets")
					.toJSON();

				await client.application.commands.create(command);
				console.log("Global /submittix command registered ✅");
			} else {
				console.log("Global /submittix command already registered ✅");
			}

			if (!existing.some((cmd) => cmd.name === "raffletix")) {
				const reportCommand = new SlashCommandBuilder()
					.setName("raffletix")
					.setDescription("Show current month raffle tickets report")
					.toJSON();

				await client.application.commands.create(reportCommand);
				console.log("Global /raffletix command registered ✅");
			} else {
				console.log("Global /raffletix command already registered ✅");
			}
		} catch (err) {
			console.error("Error registering /submittix command:", err);
		}
	});

	// ----------------- HANDLE SLASH COMMANDS -----------------
	client.on(Events.InteractionCreate, async (interaction) => {
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== "submittix") return;

		const modal = new ModalBuilder()
			.setCustomId("submittixModal")
			.setTitle("Submit Raffle Tickets");

		const chatterInput = new TextInputBuilder()
			.setCustomId("chatter")
			.setLabel("Chatter name")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		const modelInput = new TextInputBuilder()
			.setCustomId("model")
			.setLabel("Model name")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		const fanInput = new TextInputBuilder()
			.setCustomId("fan")
			.setLabel("Fan name")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		const amountInput = new TextInputBuilder()
			.setCustomId("amount")
			.setLabel("Amount (numbers only, no $)")
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		modal.addComponents(
			new ActionRowBuilder().addComponents(chatterInput),
			new ActionRowBuilder().addComponents(modelInput),
			new ActionRowBuilder().addComponents(fanInput),
			new ActionRowBuilder().addComponents(amountInput)
		);

		await interaction.showModal(modal);
	});

	client.on(Events.InteractionCreate, async (interaction) => {
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== "raffletix") return;

		await tixReady;

		const yearMonth = getEstYearMonth(new Date());
		const entries = tix.filter((entry) => {
			if (entry.yearMonth) return entry.yearMonth === yearMonth;
			if (!entry.timestamp) return false;
			return getEstYearMonth(new Date(entry.timestamp)) === yearMonth;
		});

		if (entries.length === 0) {
			return interaction.reply({
				content: "No raffle tickets submitted for the current month.",
			});
		}

		const summary = new Map();
		for (const entry of entries) {
			const key = entry.chatterName || "Unknown";
			if (!summary.has(key)) {
				summary.set(key, { tickets: 0, amount: 0, models: new Set() });
			}
			const item = summary.get(key);
			item.tickets += Number(entry.tickets || 0);
			item.amount += Number(entry.amount || 0);
			if (entry.modelName) item.models.add(entry.modelName);
		}

		const fields = Array.from(summary.entries()).map(([name, info]) => ({
			name,
			value: `Tickets: ${info.tickets}\nAmount: $${info.amount}\nModels: ${
				Array.from(info.models).join(", ") || "None"
			}`,
		}));

		const title = `Current Month Raffle Report - ${formatMonthYear(
			...(() => {
				const { year, month } = getEstParts(new Date());
				return [year, month];
			})()
		)}`;

		let hasReplied = false;
		for (let i = 0; i < fields.length; i += 25) {
			const chunk = fields.slice(i, i + 25);
			const embed = new EmbedBuilder()
				.setTitle(title)
				.setColor("Blue")
				.addFields(chunk)
				.setTimestamp();

			if (!hasReplied) {
				await interaction.reply({ embeds: [embed] });
				hasReplied = true;
			} else {
				await interaction.followUp({ embeds: [embed] });
			}
		}
	});

	// ----------------- HANDLE MODAL SUBMIT -----------------
	client.on(Events.InteractionCreate, async (interaction) => {
		if (!interaction.isModalSubmit()) return;
		if (interaction.customId !== "submittixModal") return;

		await tixReady;

		const chatterName = interaction.fields.getTextInputValue("chatter").trim();
		const modelName = interaction.fields.getTextInputValue("model").trim();
		const fanName = interaction.fields.getTextInputValue("fan").trim();
		const amountRaw = interaction.fields.getTextInputValue("amount").trim();

		if (amountRaw.includes("$")) {
			return interaction.reply({
				content: "Please enter numbers only (no $ sign).",
				ephemeral: true,
			});
		}

		if (!/^[0-9]+$/.test(amountRaw)) {
			return interaction.reply({
				content: "Amount must be a whole number (numbers only).",
				ephemeral: true,
			});
		}

		const amount = Number(amountRaw);
		if (!Number.isFinite(amount)) {
			return interaction.reply({
				content: "Amount is not a valid number.",
				ephemeral: true,
			});
		}

		if (amount < 500) {
			return interaction.reply({
				content: "Amount must be 500 or greater.",
				ephemeral: true,
			});
		}

		const tickets = 1 + Math.floor((amount - 500) / 250);

		const raffleChannel = await findChannel(interaction.guild, {
			id: RAFFLE_CHANNEL_ID,
			name: RAFFLE_CHANNEL_NAME,
			normalizedTarget: normalizeChannelName(RAFFLE_CHANNEL_NAME),
		});

		if (!raffleChannel) {
			return interaction.reply({
				content:
					"Raffle channel not found. Please check the channel ID or name.",
				ephemeral: true,
			});
		}

		tix.push({
			chatterName,
			modelName,
			fanName,
			amount,
			tickets,
			yearMonth: getEstYearMonth(new Date()),
			timestamp: new Date().toISOString(),
		});
		saveTix();
		await updateTixOnGitHub();

		const embed = new EmbedBuilder()
			.setTitle("Raffle Ticket Submission")
			.setColor("Gold")
			.addFields(
				{
					name: "Chatter",
					value: `${chatterName} (Discord: ${interaction.user.username})`,
				},
				{ name: "Model", value: modelName },
				{ name: "Fan", value: fanName },
				{ name: "Amount", value: `$${amount}` },
				{ name: "Tickets", value: `${tickets}` }
			)
			.setTimestamp();

		await raffleChannel.send({ embeds: [embed] });

		await interaction.reply({
			content: "Raffle submission sent ✅",
			ephemeral: true,
		});
	});

	// ----------------- MONTHLY REPORT -----------------
	cron.schedule(
		"0 0 1 * *",
		async () => {
			await tixReady;
			const { year, month } = getPrevEstYearMonth(new Date());
			const targetYearMonth = `${year}-${String(month).padStart(2, "0")}`;

			const entries = tix.filter((entry) => {
				if (entry.yearMonth) return entry.yearMonth === targetYearMonth;
				if (!entry.timestamp) return false;
				return getEstYearMonth(new Date(entry.timestamp)) === targetYearMonth;
			});

			const raffleChannel = await client.channels
				.fetch(RAFFLE_CHANNEL_ID)
				.catch(() => null);

			if (!raffleChannel) return;

			if (entries.length === 0) {
				await raffleChannel.send(
					`No raffle tickets submitted for ${formatMonthYear(year, month)}.`
				);
				return;
			}

			const summary = new Map();
			for (const entry of entries) {
				const key = entry.chatterName || "Unknown";
				if (!summary.has(key)) {
					summary.set(key, { tickets: 0, amount: 0, models: new Set() });
				}
				const item = summary.get(key);
				item.tickets += Number(entry.tickets || 0);
				item.amount += Number(entry.amount || 0);
				if (entry.modelName) item.models.add(entry.modelName);
			}

			const fields = Array.from(summary.entries()).map(([name, info]) => ({
				name,
				value: `Tickets: ${info.tickets}\nAmount: $${info.amount}\nModels: ${
					Array.from(info.models).join(", ") || "None"
				}`,
			}));

			const title = `Monthly Raffle Report - ${formatMonthYear(year, month)}`;
			for (let i = 0; i < fields.length; i += 25) {
				const chunk = fields.slice(i, i + 25);
				const embed = new EmbedBuilder()
					.setTitle(title)
					.setColor("Blue")
					.addFields(chunk)
					.setTimestamp();

				await raffleChannel.send({ embeds: [embed] });
			}
		},
		{ timezone: EST_TZ }
	);
};
