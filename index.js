// ╔══════════════════════════════════════════════════════════╗
// ║          🤖 NEXUS BOT — by Owner 1404076132890050571     ║
// ╚══════════════════════════════════════════════════════════╝

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
  REST, Routes, ChannelType } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({default:f})=>f(...args));
const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── KEEP ALIVE — Render Web Service gratuit ──────────────────
http.createServer((req,res)=>res.end('Evelyaa est en ligne ✅')).listen(process.env.PORT||3000);

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CONFIG = {
  TOKEN:    process.env.TOKEN      || 'VOTRE_TOKEN_ICI',
  AI_KEY:   process.env.MISTRAL_KEY|| 'VOTRE_CLE_IA_ICI',
  OWNER_ID: '1404076132890050571',
  // ID qui contrôle l'IA (mode, custom prompt, reset)
  // Mets l'ID "67" complet dans .env : AI_ADMIN=ID_COMPLET_ICI
  AI_ADMIN: process.env.AI_ADMIN   || '1404076132890050571',
  PREFIX:   process.env.PREFIX     || '!',
  AI_MODEL: 'mistral-large-latest',
  TRIGGER:  'evelyaa',  // mot magique pour déclencher l'IA
  COLOR: {
    PRIMARY:0x5865F2, SUCCESS:0x57F287, ERROR:0xED4245,
    WARNING:0xFEE75C, INFO:0x5BC0DE,   PRISON:0xFF6B35,
    DARK:0x2F3136,    GOLD:0xFFD700,
  },
  DB_PATH: './data',
};

// ─────────────────────────────────────────────
//  BASE DE DONNÉES — PERSISTANTE (jamais reset)
// ─────────────────────────────────────────────
if (!fs.existsSync(CONFIG.DB_PATH)) fs.mkdirSync(CONFIG.DB_PATH,{recursive:true});

function loadDB(name) {
  const p = path.join(CONFIG.DB_PATH,`${name}.json`);
  if (!fs.existsSync(p)) fs.writeFileSync(p,'{}');
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return {}; }
}
function saveDB(name, data) {
  fs.writeFileSync(path.join(CONFIG.DB_PATH,`${name}.json`), JSON.stringify(data,null,2));
}

// Toutes les données sont chargées depuis fichier au démarrage
// et sauvegardées à chaque modification → jamais perdues au redémarrage
let warnings  = loadDB('warnings');
let casier    = loadDB('casier');
let prisons   = loadDB('prisons');
let blacklist = loadDB('blacklist');
let economy   = loadDB('economy');    // PERSISTANT - jamais remis à zéro
let aiModes   = loadDB('aimodes');
let serverCfg = loadDB('serverconfig');
let tempVoice = loadDB('tempvoice');
let tickets   = loadDB('tickets');
let giveaways = loadDB('giveaways');
let chatHistory = {}; // historique IA en mémoire par session

// ─────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────
const client = new Client({
  intents:[
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,   GatewayIntentBits.GuildModeration,
  ],
  partials:[Partials.Message,Partials.Channel,Partials.Reaction,Partials.GuildMember],
});

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
const isOwner   = id => id === CONFIG.OWNER_ID;
const isAIAdmin = id => id === CONFIG.AI_ADMIN || isOwner(id);
const isMod     = m  => m.permissions.has(PermissionFlagsBits.ManageMessages) || isOwner(m.id);
const isAdmin   = m  => m.permissions.has(PermissionFlagsBits.Administrator)  || isOwner(m.id);

const e        = (t,d,c=CONFIG.COLOR.PRIMARY) => new EmbedBuilder().setColor(c).setTitle(t).setDescription(d).setTimestamp();
const eSuccess = (t,d) => e(`✅ ${t}`, d, CONFIG.COLOR.SUCCESS);
const eError   = (t,d) => e(`❌ ${t}`, d, CONFIG.COLOR.ERROR);
const eWarn    = (t,d) => e(`⚠️ ${t}`, d, CONFIG.COLOR.WARNING);
const eInfo    = (t,d) => e(`ℹ️ ${t}`, d, CONFIG.COLOR.INFO);

const ts       = (date=new Date()) => Math.floor(new Date(date).getTime()/1000);
const randomId = () => Math.random().toString(36).substring(2,10).toUpperCase();

function parseDuration(str) {
  const m = str?.match(/^(\d+)(s|m|h|d|w)$/);
  if (!m) return null;
  const u = {s:1000,m:60000,h:3600000,d:86400000,w:604800000};
  return parseInt(m[1]) * u[m[2]];
}
function fmtDur(ms) {
  const d=Math.floor(ms/86400000), h=Math.floor((ms%86400000)/3600000), m=Math.floor((ms%3600000)/60000);
  if (d) return `${d}j ${h}h`; if (h) return `${h}h ${m}m`; return `${m}m`;
}
async function logAction(guild, embed) {
  const ch = guild.channels.cache.get(serverCfg[guild.id]?.logCh);
  if (ch) ch.send({embeds:[embed]}).catch(()=>{});
}

// ─────────────────────────────────────────────
//  CASIER
// ─────────────────────────────────────────────
function addCasier(userId, type, reason, modId) {
  if (!casier[userId]) casier[userId] = [];
  const entry = {id:randomId(), type, reason, mod:modId, date:new Date().toISOString()};
  casier[userId].push(entry); saveDB('casier',casier); return entry;
}
const getCasier   = uid => casier[uid] || [];
const clearCasier = uid => { delete casier[uid]; saveDB('casier',casier); };

// ─────────────────────────────────────────────
//  PRISON
// ─────────────────────────────────────────────
async function imprisonUser(guild, member, reason, duration, modId) {
  const cfg = serverCfg[guild.id];
  if (!cfg?.prisonRole) return {success:false, msg:'Rôle Prison non configuré. `/setup prison-role`'};
  if (!guild.roles.cache.get(cfg.prisonRole)) return {success:false, msg:'Rôle Prison introuvable.'};
  const rolesBefore = member.roles.cache.filter(r=>r.id!==guild.id).map(r=>r.id);
  await member.roles.set([cfg.prisonRole]).catch(()=>{});
  const until = duration ? Date.now()+duration : null;
  prisons[member.id] = {guildId:guild.id, until, reason, rolesBefore, mod:modId};
  saveDB('prisons',prisons); addCasier(member.id,'🔒 Prison',reason,modId);
  if (until) setTimeout(()=>releaseUser(guild,member.id,'Peine accomplie'), duration);
  return {success:true};
}
async function releaseUser(guild, userId, reason='Libération manuelle') {
  const p = prisons[userId]; if (!p) return false;
  const member = await guild.members.fetch(userId).catch(()=>null);
  if (member) await member.roles.set(p.rolesBefore||[]).catch(()=>{});
  delete prisons[userId]; saveDB('prisons',prisons);
  addCasier(userId,'🔓 Libération',reason,client.user.id); return true;
}

// ─────────────────────────────────────────────
//  BLACKLIST
// ─────────────────────────────────────────────
function addBlacklist(userId, reason, modId) {
  blacklist[userId] = {reason, mod:modId, date:new Date().toISOString()};
  saveDB('blacklist',blacklist); addCasier(userId,'⛔ Blacklist',reason,modId);
}
const removeBlacklist = uid => { delete blacklist[uid]; saveDB('blacklist',blacklist); };
const isBlacklisted   = uid => !!blacklist[uid];

// ─────────────────────────────────────────────
//  ÉCONOMIE — PERSISTANTE
// ─────────────────────────────────────────────
function getEco(userId) {
  if (!economy[userId]) economy[userId] = {
    coins:0, bank:0, xp:0, level:1,
    lastDaily:null, lastWork:null, lastCrime:null, lastRob:null,
    streak:0, inventory:[], totalEarned:0,
  };
  return economy[userId];
}
const saveEco = () => saveDB('economy', economy);

function addCoins(userId, amount) {
  const u = getEco(userId);
  u.coins += amount;
  if (amount > 0) u.totalEarned = (u.totalEarned||0) + amount;
  saveEco();
}
function addXP(userId, amount) {
  const u = getEco(userId); u.xp += amount;
  if (u.xp >= u.level * 100) { u.xp -= u.level*100; u.level++; saveEco(); return true; }
  saveEco(); return false;
}

// Items de la boutique
const SHOP_ITEMS = [
  {id:'protection',  name:'🛡️ Protection vol',   price:3000,  desc:'Immunité contre /rob pendant 24h'},
  {id:'xp_boost',    name:'⚡ Boost XP x2',       price:2000,  desc:'Double ton XP pendant 1h'},
  {id:'jail_pass',   name:'🔑 Pass Prison',        price:8000,  desc:'Sors de prison gratuitement une fois'},
  {id:'lottery',     name:'🎰 Ticket Loto',        price:500,   desc:'Tente ta chance ! Gain possible x5'},
  {id:'mystery_box', name:'📦 Boîte Mystère',      price:1000,  desc:'Contenu aléatoire (50 à 3000 coins)'},
  {id:'flex_badge',  name:'💎 Badge Flex',         price:10000, desc:'Badge exclusif sur ton /profil'},
  {id:'daily_x2',    name:'📅 Daily x2',           price:5000,  desc:'Double ta récompense daily pendant 3 jours'},
  {id:'rob_shield',  name:'🔒 Anti-Rob 7j',        price:4000,  desc:'Protège-toi du vol pendant 7 jours'},
];

// ─────────────────────────────────────────────
//  AUTO-MOD
// ─────────────────────────────────────────────
const BANNED_WORDS   = ['slur1','slur2','insulte1']; // ← Remplace par tes vrais mots
const SPAM_MAP       = new Map();
const LINK_WHITELIST = ['discord.gg','youtube.com','youtu.be','twitch.tv','imgur.com'];

async function runAutoMod(message) {
  if (!message.guild || message.author.bot) return false;
  if (isOwner(message.author.id)) return false;
  if (isMod(message.member)) return false;
  const cfg = serverCfg[message.guild.id];
  if (!cfg?.automod) return false;

  const content = message.content, uid = message.author.id;
  let violated = false, violReason = '';

  if (BANNED_WORDS.some(w=>content.toLowerCase().includes(w))) { violated=true; violReason='Mot interdit'; }
  if (!violated) {
    const now=Date.now(), arr=SPAM_MAP.get(uid)||[];
    arr.push(now); const recent=arr.filter(t=>now-t<5000); SPAM_MAP.set(uid,recent);
    if (recent.length >= 5) { violated=true; violReason='Spam détecté'; }
  }
  if (!violated && content.length > 10) {
    const up = content.split('').filter(c=>c>='A'&&c<='Z').length;
    if (up/content.length > 0.7) { violated=true; violReason='Excès de majuscules'; }
  }
  if (!violated && cfg.noLinks) {
    const urls = content.match(/https?:\/\/[^\s]+/gi)||[];
    for (const url of urls) {
      if (!LINK_WHITELIST.some(d=>url.includes(d))) { violated=true; violReason='Lien non autorisé'; break; }
    }
  }
  if (!violated && /discord\.gg\//i.test(content)) { violated=true; violReason='Invitation Discord non autorisée'; }
  if (!violated && (content.includes('@everyone')||content.includes('@here')))
    if (!message.member.permissions.has(PermissionFlagsBits.MentionEveryone)) { violated=true; violReason='Mention de masse'; }

  if (!violated) return false;

  await message.delete().catch(()=>{});
  if (!warnings[uid]) warnings[uid] = [];
  warnings[uid].push({reason:`[AutoMod] ${violReason}`, mod:client.user.id, date:new Date().toISOString()});
  saveDB('warnings',warnings);
  addCasier(uid,'🤖 AutoMod',violReason,client.user.id);
  const count = warnings[uid].length;

  const warn = await message.channel.send({embeds:[eWarn('AutoMod',`${message.author} — **${violReason}**\nAvertissements: **${count}**`)]});
  setTimeout(()=>warn.delete().catch(()=>{}),7000);

  if (count >= 10 && cfg.prisonRole)
    await imprisonUser(message.guild, message.member, 'AutoMod: 10 avertissements', 3600000, client.user.id);
  else if (count >= 5)
    await message.member.timeout(300000,'AutoMod: 5 avertissements').catch(()=>{});

  await logAction(message.guild, e('🤖 AutoMod',`**User:** ${message.author.tag}\n**Raison:** ${violReason}\n**Avertissements:** ${count}`,CONFIG.COLOR.WARNING));
  return true;
}

// ─────────────────────────────────────────────
//  IA — contrôlée par AI_ADMIN uniquement
//  Aucune mention du fournisseur dans les messages
// ─────────────────────────────────────────────
const AI_MODES = {
  assistant: {name:'🤖 Assistant', prompt:'Tu es Evelyaa, une assistante Discord utile, précise et amicale. Réponds toujours en français.'},
  fun:       {name:'🎉 Fun',       prompt:"Tu es Evelyaa, un bot Discord fun avec des emojis et de l'humour. Réponds en français."},
  strict:    {name:'⚔️ Strict',   prompt:'Tu es Evelyaa, une assistante stricte et formelle. Réponses courtes et directes. Français.'},
  roast:     {name:'🔥 Roast',    prompt:'Tu es Evelyaa, spécialisée dans les taquineries bienveillantes. Jamais vraiment méchant. Français.'},
  teacher:   {name:'📚 Prof',     prompt:'Tu es Evelyaa, une professeure patiente qui explique avec des exemples. Français.'},
  custom:    {name:'✨ Custom',   prompt:''},
};

async function askAI(userId, userMessage, guildId) {
  const modeKey = aiModes[guildId]?.mode || 'assistant';
  let systemPrompt = AI_MODES[modeKey]?.prompt || AI_MODES.assistant.prompt;
  if (modeKey === 'custom' && aiModes[guildId]?.customPrompt) systemPrompt = aiModes[guildId].customPrompt;

  if (!chatHistory[userId]) chatHistory[userId] = [];
  chatHistory[userId].push({role:'user', content:userMessage});
  if (chatHistory[userId].length > 20) chatHistory[userId] = chatHistory[userId].slice(-20);

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${CONFIG.AI_KEY}`},
    body: JSON.stringify({
      model: CONFIG.AI_MODEL,
      messages: [{role:'system',content:systemPrompt}, ...chatHistory[userId]],
      max_tokens: 800, temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`Erreur IA: ${res.status}`);
  const data = await res.json();
  const reply = data.choices[0].message.content;
  chatHistory[userId].push({role:'assistant', content:reply});
  return reply;
}

// ─────────────────────────────────────────────
//  GIVEAWAY END
// ─────────────────────────────────────────────
async function endGiveaway(msgId) {
  const g = giveaways[msgId]; if (!g) return;
  const ch = client.channels.cache.get(g.channelId); if (!ch) return;
  const shuffled = [...g.entries].sort(()=>Math.random()-0.5);
  const winnerIds = shuffled.slice(0, Math.min(g.winners, shuffled.length));
  const winText = winnerIds.length ? winnerIds.map(id=>`<@${id}>`).join(', ') : 'Aucun gagnant 😢';
  try {
    const msg = await ch.messages.fetch(msgId);
    const em = EmbedBuilder.from(msg.embeds[0]).setColor(CONFIG.COLOR.WARNING)
      .setTitle(`🎉 GIVEAWAY TERMINÉ — ${g.prize}`)
      .setDescription(`**Gagnants:** ${winText}\n**Participants:** ${g.entries.length}`);
    await msg.edit({embeds:[em], components:[]});
  } catch {}
  if (winnerIds.length) ch.send({embeds:[eSuccess('Giveaway',`Félicitations ${winText} ! Vous gagnez **${g.prize}** 🎉`)]});
}

// ─────────────────────────────────────────────
//  SLASH COMMANDS
// ─────────────────────────────────────────────
const slashCommands = [
  new SlashCommandBuilder().setName('setup').setDescription('⚙️ Configuration')
    .addSubcommand(s=>s.setName('welcome').setDescription('Salon bienvenue').addChannelOption(o=>o.setName('salon').setDescription('Salon').setRequired(true)))
    .addSubcommand(s=>s.setName('logs').setDescription('Salon logs').addChannelOption(o=>o.setName('salon').setDescription('Salon').setRequired(true)))
    .addSubcommand(s=>s.setName('mod').setDescription('Salon modération').addChannelOption(o=>o.setName('salon').setDescription('Salon').setRequired(true)))
    .addSubcommand(s=>s.setName('prison-role').setDescription('Rôle prison').addRoleOption(o=>o.setName('role').setDescription('Rôle').setRequired(true)))
    .addSubcommand(s=>s.setName('automod').setDescription('AutoMod on/off').addBooleanOption(o=>o.setName('actif').setDescription('Activé?').setRequired(true)))
    .addSubcommand(s=>s.setName('no-links').setDescription('Bloquer les liens').addBooleanOption(o=>o.setName('actif').setDescription('Activé?').setRequired(true)))
    .addSubcommand(s=>s.setName('voir').setDescription('Voir la config')),

  new SlashCommandBuilder().setName('ia').setDescription('🤖 Contrôle IA (Admin IA uniquement)')
    .addSubcommand(s=>s.setName('mode').setDescription('Changer le mode').addStringOption(o=>o.setName('mode').setDescription('Mode').setRequired(true).addChoices(
      {name:'🤖 Assistant',value:'assistant'},{name:'🎉 Fun',value:'fun'},
      {name:'⚔️ Strict',value:'strict'},{name:'🔥 Roast',value:'roast'},{name:'📚 Prof',value:'teacher'}
    )))
    .addSubcommand(s=>s.setName('custom').setDescription('Prompt personnalisé').addStringOption(o=>o.setName('prompt').setDescription('Prompt système').setRequired(true)))
    .addSubcommand(s=>s.setName('reset').setDescription('Reset historique').addUserOption(o=>o.setName('membre').setDescription('Membre (vide=soi-même)')))
    .addSubcommand(s=>s.setName('status').setDescription('Voir le mode actuel')),

  new SlashCommandBuilder().setName('warn').setDescription('⚠️ Avertir')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addStringOption(o=>o.setName('raison').setDescription('Raison').setRequired(true)),
  new SlashCommandBuilder().setName('warns').setDescription('📋 Voir avertissements').addUserOption(o=>o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('clearwarn').setDescription('🗑️ Clear avertissements').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('mute').setDescription('🔇 Mute')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addStringOption(o=>o.setName('duree').setDescription('Durée ex: 10m 1h 1d').setRequired(true))
    .addStringOption(o=>o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('unmute').setDescription('🔊 Unmute').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('👢 Kick')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addStringOption(o=>o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('ban').setDescription('🔨 Ban')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addStringOption(o=>o.setName('raison').setDescription('Raison'))
    .addIntegerOption(o=>o.setName('jours').setDescription('Jours msgs supprimés').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('🔓 Unban').addStringOption(o=>o.setName('id').setDescription('ID').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('🗑️ Purge')
    .addIntegerOption(o=>o.setName('nombre').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o=>o.setName('membre').setDescription('Filtrer par membre')),
  new SlashCommandBuilder().setName('slowmode').setDescription('🐌 Slowmode').addIntegerOption(o=>o.setName('secondes').setDescription('0=off').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lock').setDescription('🔒 Verrouiller le salon'),
  new SlashCommandBuilder().setName('unlock').setDescription('🔓 Déverrouiller le salon'),

  new SlashCommandBuilder().setName('prison').setDescription('🔒 Emprisonner')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addStringOption(o=>o.setName('raison').setDescription('Raison').setRequired(true))
    .addStringOption(o=>o.setName('duree').setDescription('Durée ex: 1h 1d (vide=perm)')),
  new SlashCommandBuilder().setName('liberer').setDescription('🔓 Libérer').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('prisonniers').setDescription('🏛️ Liste prisonniers'),

  new SlashCommandBuilder().setName('casier').setDescription('📁 Casier judiciaire')
    .addSubcommand(s=>s.setName('voir').setDescription('Voir casier').addUserOption(o=>o.setName('membre').setDescription('Membre')))
    .addSubcommand(s=>s.setName('effacer').setDescription('Effacer (Owner)').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))),

  new SlashCommandBuilder().setName('blacklist').setDescription('⛔ Blacklist')
    .addSubcommand(s=>s.setName('add').setDescription('Blacklister').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)).addStringOption(o=>o.setName('raison').setDescription('Raison').setRequired(true)))
    .addSubcommand(s=>s.setName('remove').setDescription('Retirer').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s=>s.setName('voir').setDescription('Voir la liste')),

  new SlashCommandBuilder().setName('solde').setDescription('💰 Voir son portefeuille').addUserOption(o=>o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('daily').setDescription('📅 Récompense quotidienne + streak'),
  new SlashCommandBuilder().setName('work').setDescription('💼 Travailler (cooldown 1h)'),
  new SlashCommandBuilder().setName('crime').setDescription('🔫 Commettre un crime (risqué, cooldown 2h)'),
  new SlashCommandBuilder().setName('rob').setDescription('🥷 Voler quelqu\'un').addUserOption(o=>o.setName('membre').setDescription('Victime').setRequired(true)),
  new SlashCommandBuilder().setName('pay').setDescription('💸 Donner des coins')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addIntegerOption(o=>o.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('depot').setDescription('🏦 Déposer en banque').addIntegerOption(o=>o.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('retrait').setDescription('🏦 Retirer de la banque').addIntegerOption(o=>o.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('🏆 Classement richesse'),
  new SlashCommandBuilder().setName('shop').setDescription('🛒 Voir la boutique'),
  new SlashCommandBuilder().setName('acheter').setDescription('🛍️ Acheter un item').addStringOption(o=>o.setName('item').setDescription('ID de l\'item (voir /shop)').setRequired(true)),
  new SlashCommandBuilder().setName('inventaire').setDescription('🎒 Voir son inventaire').addUserOption(o=>o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('give-coins').setDescription('💎 Give coins (Owner)')
    .addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))
    .addIntegerOption(o=>o.setName('montant').setDescription('Montant').setRequired(true)),

  new SlashCommandBuilder().setName('profil').setDescription('👤 Profil').addUserOption(o=>o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('🏠 Infos serveur'),
  new SlashCommandBuilder().setName('userinfo').setDescription('🧑 Infos utilisateur').addUserOption(o=>o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('avatar').setDescription('🖼️ Avatar').addUserOption(o=>o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('ping').setDescription('🏓 Ping'),
  new SlashCommandBuilder().setName('uptime').setDescription('⏱️ Uptime'),
  new SlashCommandBuilder().setName('botinfo').setDescription('🤖 Infos bot'),
  new SlashCommandBuilder().setName('help').setDescription('📚 Aide'),

  new SlashCommandBuilder().setName('8ball').setDescription('🎱 Boule magique').addStringOption(o=>o.setName('question').setDescription('Question').setRequired(true)),
  new SlashCommandBuilder().setName('coin').setDescription('🪙 Pile ou face'),
  new SlashCommandBuilder().setName('dice').setDescription('🎲 Dé').addIntegerOption(o=>o.setName('faces').setDescription('Faces (défaut 6)').setMinValue(2).setMaxValue(1000)),
  new SlashCommandBuilder().setName('rps').setDescription('✂️ Pierre-Feuille-Ciseaux').addStringOption(o=>o.setName('choix').setDescription('Choix').setRequired(true).addChoices({name:'Pierre',value:'pierre'},{name:'Feuille',value:'feuille'},{name:'Ciseaux',value:'ciseaux'})),

  new SlashCommandBuilder().setName('ticket').setDescription('🎫 Tickets')
    .addSubcommand(s=>s.setName('panel').setDescription('Envoyer le panel'))
    .addSubcommand(s=>s.setName('close').setDescription('Fermer le ticket'))
    .addSubcommand(s=>s.setName('add').setDescription('Ajouter membre').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s=>s.setName('remove').setDescription('Retirer membre').addUserOption(o=>o.setName('membre').setDescription('Membre').setRequired(true))),

  new SlashCommandBuilder().setName('giveaway').setDescription('🎉 Giveaway')
    .addSubcommand(s=>s.setName('start').setDescription('Lancer')
      .addStringOption(o=>o.setName('duree').setDescription('Durée').setRequired(true))
      .addIntegerOption(o=>o.setName('gagnants').setDescription('Nb gagnants').setRequired(true).setMinValue(1))
      .addStringOption(o=>o.setName('prix').setDescription('Prix').setRequired(true)))
    .addSubcommand(s=>s.setName('end').setDescription('Terminer').addStringOption(o=>o.setName('message-id').setDescription('ID msg').setRequired(true)))
    .addSubcommand(s=>s.setName('reroll').setDescription('Reroll').addStringOption(o=>o.setName('message-id').setDescription('ID msg').setRequired(true))),

  new SlashCommandBuilder().setName('voice').setDescription('🎤 Vocal temporaire')
    .addSubcommand(s=>s.setName('setup').setDescription('Hub vocal').addChannelOption(o=>o.setName('salon').setDescription('Hub').setRequired(true)))
    .addSubcommand(s=>s.setName('rename').setDescription('Renommer').addStringOption(o=>o.setName('nom').setDescription('Nom').setRequired(true)))
    .addSubcommand(s=>s.setName('limit').setDescription('Limite').addIntegerOption(o=>o.setName('limite').setDescription('0=illimité').setRequired(true).setMinValue(0).setMaxValue(99)))
    .addSubcommand(s=>s.setName('lock').setDescription('Verrouiller'))
    .addSubcommand(s=>s.setName('unlock').setDescription('Déverrouiller')),

].map(c=>c.toJSON());

// ─────────────────────────────────────────────
//  REGISTER COMMANDS
// ─────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({version:'10'}).setToken(CONFIG.TOKEN);
  try {
    console.log('📡 Enregistrement des slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), {body:slashCommands});
    console.log(`✅ ${slashCommands.length} commandes enregistrées.`);
  } catch(err) { console.error('❌', err); }
}

// ─────────────────────────────────────────────
//  INTERACTIONS
// ─────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) return handleCmd(interaction);
  if (interaction.isButton())           return handleButton(interaction);
});

async function handleCmd(interaction) {
  const {commandName:cmd, options, guild, member, user, channel} = interaction;

  if (isBlacklisted(user.id) && !isOwner(user.id))
    return interaction.reply({embeds:[eError('Blacklisté',`Tu es blacklisté. Raison: **${blacklist[user.id].reason}**`)],ephemeral:true});

  try {

    if (cmd==='ping') {
      const sent = await interaction.reply({embeds:[eInfo('🏓 Pong!','Calcul...')],fetchReply:true});
      return interaction.editReply({embeds:[eInfo('🏓 Pong!',`Bot: **${sent.createdTimestamp-interaction.createdTimestamp}ms**\nWS: **${client.ws.ping}ms**`)]});
    }

    if (cmd==='uptime') return interaction.reply({embeds:[eInfo('⏱️ Uptime',`En ligne depuis: <t:${Math.floor((Date.now()-client.uptime)/1000)}:R>`)]});

    if (cmd==='botinfo') {
      const modeKey = aiModes[guild?.id]?.mode||'assistant';
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle('🤖 Evelyaa — Infos')
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          {name:'👑 Owner',value:`<@${CONFIG.OWNER_ID}>`,inline:true},
          {name:'📡 Serveurs',value:`${client.guilds.cache.size}`,inline:true},
          {name:'👥 Membres',value:`${client.guilds.cache.reduce((a,g)=>a+g.memberCount,0)}`,inline:true},
          {name:'⚡ Ping',value:`${client.ws.ping}ms`,inline:true},
          {name:'🧠 Mode IA',value:AI_MODES[modeKey].name,inline:true},
          {name:'🔑 Trigger',value:`\`${CONFIG.TRIGGER}\``,inline:true},
        ).setTimestamp()]});
    }

    if (cmd==='help') {
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle('📚 Evelyaa — Aide')
        .setDescription(`**Parler à l'IA:** Écris \`${CONFIG.TRIGGER} ta question\` dans n'importe quel salon !\nEx: \`evelyaa enlève-lui le rôle modo\`\n\n*Toutes les commandes en slash \`/\`*`)
        .addFields(
          {name:'⚙️ Setup',value:'`/setup welcome logs mod prison-role automod no-links voir`'},
          {name:'🛡️ Modération',value:'`/warn warns clearwarn mute unmute kick ban unban purge slowmode lock unlock`'},
          {name:'🔒 Prison',value:'`/prison liberer prisonniers`'},
          {name:'📁 Casier',value:'`/casier voir effacer`'},
          {name:'⛔ Blacklist',value:'`/blacklist add remove voir`'},
          {name:'💰 Économie',value:'`/solde daily work crime rob pay depot retrait leaderboard shop acheter inventaire`'},
          {name:'🤖 IA',value:'`/ia mode custom reset status` *(Admin IA uniquement)*'},
          {name:'🎉 Giveaway',value:'`/giveaway start end reroll`'},
          {name:'🎫 Tickets',value:'`/ticket panel close add remove`'},
          {name:'🎤 Vocal',value:'`/voice setup rename limit lock unlock`'},
          {name:'🎲 Fun',value:'`/8ball coin dice rps`'},
          {name:'👤 Info',value:'`/profil serverinfo userinfo avatar ping uptime botinfo`'},
        ).setFooter({text:`Owner: ${CONFIG.OWNER_ID} | Trigger: ${CONFIG.TRIGGER}`}).setTimestamp()]});
    }

    // SETUP
    if (cmd==='setup') {
      if (!isAdmin(member)) return interaction.reply({embeds:[eError('Permission','Administrateur requis.')],ephemeral:true});
      if (!serverCfg[guild.id]) serverCfg[guild.id]={};
      const sub = options.getSubcommand();
      if (sub==='welcome')     {serverCfg[guild.id].welcomeCh =options.getChannel('salon').id;saveDB('serverconfig',serverCfg);return interaction.reply({embeds:[eSuccess('Setup',`Bienvenue: <#${serverCfg[guild.id].welcomeCh}>`)]}); }
      if (sub==='logs')        {serverCfg[guild.id].logCh     =options.getChannel('salon').id;saveDB('serverconfig',serverCfg);return interaction.reply({embeds:[eSuccess('Setup',`Logs: <#${serverCfg[guild.id].logCh}>`)]}); }
      if (sub==='mod')         {serverCfg[guild.id].modCh     =options.getChannel('salon').id;saveDB('serverconfig',serverCfg);return interaction.reply({embeds:[eSuccess('Setup',`Modération: <#${serverCfg[guild.id].modCh}>`)]}); }
      if (sub==='prison-role') {serverCfg[guild.id].prisonRole=options.getRole('role').id;    saveDB('serverconfig',serverCfg);return interaction.reply({embeds:[eSuccess('Setup',`Rôle prison: <@&${serverCfg[guild.id].prisonRole}>`)]}); }
      if (sub==='automod')     {serverCfg[guild.id].automod   =options.getBoolean('actif');  saveDB('serverconfig',serverCfg);return interaction.reply({embeds:[eSuccess('AutoMod',`AutoMod **${serverCfg[guild.id].automod?'activé ✅':'désactivé ❌'}**`)]}); }
      if (sub==='no-links')    {serverCfg[guild.id].noLinks   =options.getBoolean('actif');  saveDB('serverconfig',serverCfg);return interaction.reply({embeds:[eSuccess('Liens',`Filtre liens **${serverCfg[guild.id].noLinks?'activé ✅':'désactivé ❌'}**`)]}); }
      if (sub==='voir') {
        const c = serverCfg[guild.id]||{};
        return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.INFO).setTitle('⚙️ Configuration')
          .addFields(
            {name:'👋 Bienvenue',value:c.welcomeCh?`<#${c.welcomeCh}>`:'Non configuré',inline:true},
            {name:'📋 Logs',value:c.logCh?`<#${c.logCh}>`:'Non configuré',inline:true},
            {name:'🛡️ Mod',value:c.modCh?`<#${c.modCh}>`:'Non configuré',inline:true},
            {name:'🔒 Prison',value:c.prisonRole?`<@&${c.prisonRole}>`:'Non configuré',inline:true},
            {name:'🤖 AutoMod',value:c.automod?'✅':'❌',inline:true},
            {name:'🔗 No-Links',value:c.noLinks?'✅':'❌',inline:true},
            {name:'🎤 Hub Vocal',value:c.voiceHub?`<#${c.voiceHub}>`:'Non configuré',inline:true},
          )]});
      }
    }

    // IA — seulement AI_ADMIN peut changer les paramètres
    if (cmd==='ia') {
      if (!isAIAdmin(user.id)) return interaction.reply({embeds:[eError('Permission','Seul l\'administrateur IA peut modifier les paramètres IA.')],ephemeral:true});
      const sub = options.getSubcommand();
      if (sub==='mode') {
        const mode = options.getString('mode');
        if (!aiModes[guild.id]) aiModes[guild.id]={};
        aiModes[guild.id].mode = mode; saveDB('aimodes',aiModes);
        return interaction.reply({embeds:[eSuccess('Mode IA',`Mode changé en **${AI_MODES[mode].name}**`)]});
      }
      if (sub==='custom') {
        if (!aiModes[guild.id]) aiModes[guild.id]={};
        aiModes[guild.id].mode='custom'; aiModes[guild.id].customPrompt=options.getString('prompt');
        saveDB('aimodes',aiModes);
        return interaction.reply({embeds:[eSuccess('IA Custom','Prompt personnalisé défini !')],ephemeral:true});
      }
      if (sub==='reset') {
        const target = options.getMember('membre')||member;
        chatHistory[target.id]=[];
        return interaction.reply({embeds:[eSuccess('IA Reset',`Historique de ${target} effacé.`)],ephemeral:true});
      }
      if (sub==='status') {
        const modeKey = aiModes[guild.id]?.mode||'assistant';
        const prompt = modeKey==='custom' ? aiModes[guild.id]?.customPrompt : AI_MODES[modeKey].prompt;
        return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.INFO).setTitle('🤖 Statut IA')
          .addFields(
            {name:'Mode actuel',value:AI_MODES[modeKey].name},
            {name:'Prompt',value:(prompt||'Non défini').substring(0,1024)},
          ).setFooter({text:`Admin IA: ${CONFIG.AI_ADMIN}`})],ephemeral:true});
      }
    }

    // WARN
    if (cmd==='warn') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      const target=options.getMember('membre'), reason=options.getString('raison');
      if (!warnings[target.id]) warnings[target.id]=[];
      warnings[target.id].push({reason, mod:user.id, date:new Date().toISOString()});
      saveDB('warnings',warnings); addCasier(target.id,'⚠️ Avertissement',reason,user.id);
      const count = warnings[target.id].length;
      await interaction.reply({embeds:[eWarn('Avertissement',`${target} — **${reason}**\nTotal: **${count}**`)]});
      await logAction(guild, e('⚠️ Warn',`**Membre:** ${target.user.tag}\n**Raison:** ${reason}\n**Mod:** ${user.tag}\n**Total:** ${count}`,CONFIG.COLOR.WARNING));
      try { await target.send({embeds:[eWarn('Avertissement',`Sur **${guild.name}**\nRaison: **${reason}**\nTotal: **${count}**`)]}); } catch {}
    }

    if (cmd==='warns') {
      const target=options.getMember('membre')||member, w=warnings[target.id]||[];
      if (!w.length) return interaction.reply({embeds:[eInfo('Avertissements',`${target} — aucun avertissement.`)]});
      return interaction.reply({embeds:[eWarn(`Warns — ${target.user.tag}`,w.map((x,i)=>`\`${i+1}.\` ${x.reason} — <@${x.mod}> <t:${ts(x.date)}:R>`).join('\n')).setFooter({text:`Total: ${w.length}`})]});
    }

    if (cmd==='clearwarn') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      warnings[options.getMember('membre').id]=[]; saveDB('warnings',warnings);
      return interaction.reply({embeds:[eSuccess('Warns effacés','Avertissements supprimés.')]});
    }

    if (cmd==='mute') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      const target=options.getMember('membre'), dur=parseDuration(options.getString('duree')), reason=options.getString('raison')||'Aucune raison';
      if (!dur) return interaction.reply({embeds:[eError('Format','Durée invalide. Ex: `10m 1h 1d`')],ephemeral:true});
      await target.timeout(dur,reason); addCasier(target.id,'🔇 Mute',reason,user.id);
      await interaction.reply({embeds:[eSuccess('Mute',`${target} muté **${fmtDur(dur)}** — ${reason}`)]});
      await logAction(guild, e('🔇 Mute',`**Membre:** ${target.user.tag}\n**Durée:** ${fmtDur(dur)}\n**Raison:** ${reason}\n**Mod:** ${user.tag}`,CONFIG.COLOR.WARNING));
    }

    if (cmd==='unmute') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      await options.getMember('membre').timeout(null);
      return interaction.reply({embeds:[eSuccess('Unmute','Timeout retiré.')]});
    }

    if (cmd==='kick') {
      if (!member.permissions.has(PermissionFlagsBits.KickMembers)&&!isOwner(user.id)) return interaction.reply({embeds:[eError('Permission','KickMembers requis.')],ephemeral:true});
      const target=options.getMember('membre'), reason=options.getString('raison')||'Aucune raison';
      try { await target.send({embeds:[eError('Expulsé',`Expulsé de **${guild.name}**\nRaison: ${reason}`)]}); } catch {}
      await target.kick(reason); addCasier(target.id,'👢 Kick',reason,user.id);
      await interaction.reply({embeds:[eSuccess('Kick',`${target.user.tag} expulsé — ${reason}`)]});
      await logAction(guild, e('👢 Kick',`**Membre:** ${target.user.tag}\n**Raison:** ${reason}\n**Mod:** ${user.tag}`,CONFIG.COLOR.ERROR));
    }

    if (cmd==='ban') {
      if (!member.permissions.has(PermissionFlagsBits.BanMembers)&&!isOwner(user.id)) return interaction.reply({embeds:[eError('Permission','BanMembers requis.')],ephemeral:true});
      const target=options.getMember('membre'), reason=options.getString('raison')||'Aucune raison', days=options.getInteger('jours')||0;
      try { await target.send({embeds:[eError('Banni',`Banni de **${guild.name}**\nRaison: ${reason}`)]}); } catch {}
      await target.ban({reason,deleteMessageDays:days}); addCasier(target.id,'🔨 Ban',reason,user.id);
      await interaction.reply({embeds:[eSuccess('Ban',`${target.user.tag} banni — ${reason}`)]});
      await logAction(guild, e('🔨 Ban',`**Membre:** ${target.user.tag}\n**Raison:** ${reason}\n**Mod:** ${user.tag}`,CONFIG.COLOR.ERROR));
    }

    if (cmd==='unban') {
      if (!member.permissions.has(PermissionFlagsBits.BanMembers)&&!isOwner(user.id)) return interaction.reply({embeds:[eError('Permission','BanMembers requis.')],ephemeral:true});
      await guild.bans.remove(options.getString('id'));
      return interaction.reply({embeds:[eSuccess('Unban',`<@${options.getString('id')}> débanni.`)]});
    }

    if (cmd==='purge') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      let msgs = await channel.messages.fetch({limit:100});
      const fm = options.getMember('membre');
      if (fm) msgs = msgs.filter(m=>m.author.id===fm.id);
      const toDelete = [...msgs.values()].slice(0,options.getInteger('nombre'));
      await channel.bulkDelete(toDelete,true);
      const r = await interaction.reply({embeds:[eSuccess('Purge',`**${toDelete.length}** messages supprimés.`)],fetchReply:true});
      setTimeout(()=>r.delete().catch(()=>{}),5000);
    }

    if (cmd==='slowmode') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      const s=options.getInteger('secondes'); await channel.setRateLimitPerUser(s);
      return interaction.reply({embeds:[eSuccess('Slowmode',s===0?'Désactivé.':`**${s}s**`)]});
    }

    if (cmd==='lock') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      await channel.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:false});
      return interaction.reply({embeds:[e('🔒 Verrouillé','Personne ne peut écrire.',CONFIG.COLOR.WARNING)]});
    }
    if (cmd==='unlock') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      await channel.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:null});
      return interaction.reply({embeds:[eSuccess('Déverrouillé','Salon ouvert.')]});
    }

    if (cmd==='prison') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      const target=options.getMember('membre'), reason=options.getString('raison');
      const durStr=options.getString('duree'), dur=durStr?parseDuration(durStr):null;
      const result = await imprisonUser(guild,target,reason,dur,user.id);
      if (!result.success) return interaction.reply({embeds:[eError('Prison',result.msg)],ephemeral:true});
      const durText = dur?`pendant **${fmtDur(dur)}**`:'**définitivement**';
      await interaction.reply({embeds:[e('🔒 Emprisonné',`${target} emprisonné ${durText}\n**Raison:** ${reason}`,CONFIG.COLOR.PRISON)]});
      await logAction(guild, e('🔒 Prison',`**Membre:** ${target.user.tag}\n**Durée:** ${durText}\n**Raison:** ${reason}\n**Mod:** ${user.tag}`,CONFIG.COLOR.PRISON));
    }

    if (cmd==='liberer') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      const target=options.getMember('membre'), ok=await releaseUser(guild,target.id);
      if (!ok) return interaction.reply({embeds:[eError('Prison',`${target} n'est pas emprisonné.`)],ephemeral:true});
      return interaction.reply({embeds:[eSuccess('Libéré',`${target} a été libéré.`)]});
    }

    if (cmd==='prisonniers') {
      const list = Object.entries(prisons).filter(([,v])=>v.guildId===guild.id);
      if (!list.length) return interaction.reply({embeds:[eInfo('Prison','Aucun prisonnier.')]});
      return interaction.reply({embeds:[e('🏛️ Prisonniers',list.map(([id,v])=>`<@${id}> — ${v.reason}${v.until?` (libre <t:${Math.floor(v.until/1000)}:R>)`:' (perm)'}`).join('\n'),CONFIG.COLOR.PRISON)]});
    }

    if (cmd==='casier') {
      const sub = options.getSubcommand();
      if (sub==='voir') {
        const target=options.getMember('membre')||member, c=getCasier(target.id);
        if (!c.length) return interaction.reply({embeds:[eSuccess('Casier',`${target} — casier vierge ✨`)]});
        const list = c.map((x,i)=>`\`${i+1}.\` **${x.type}** — ${x.reason}\n> <@${x.mod}> | <t:${ts(x.date)}:d> | \`${x.id}\``).join('\n\n');
        return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRISON).setTitle(`📁 Casier — ${target.user?.tag||target.displayName}`).setDescription(list).setFooter({text:`${c.length} entrée(s)`}).setTimestamp()]});
      }
      if (sub==='effacer') {
        if (!isOwner(user.id)) return interaction.reply({embeds:[eError('Permission','Owner uniquement.')],ephemeral:true});
        clearCasier(options.getMember('membre').id);
        return interaction.reply({embeds:[eSuccess('Casier effacé','Casier supprimé.')]});
      }
    }

    if (cmd==='blacklist') {
      if (!isOwner(user.id)) return interaction.reply({embeds:[eError('Permission','Owner uniquement.')],ephemeral:true});
      const sub = options.getSubcommand();
      if (sub==='add')    { addBlacklist(options.getMember('membre').id,options.getString('raison'),user.id); return interaction.reply({embeds:[eError('Blacklist',`Blacklisté. Raison: **${options.getString('raison')}**`)]}); }
      if (sub==='remove') { removeBlacklist(options.getMember('membre').id); return interaction.reply({embeds:[eSuccess('Blacklist','Retiré.')]}); }
      if (sub==='voir') {
        const list = Object.entries(blacklist);
        if (!list.length) return interaction.reply({embeds:[eInfo('Blacklist','Liste vide.')]});
        return interaction.reply({embeds:[eError('⛔ Blacklist',list.map(([id,v])=>`<@${id}> — ${v.reason}`).join('\n')).setFooter({text:`${list.length} entrée(s)`})]});
      }
    }

    // ─── ÉCONOMIE ─────────────────────────────────────────────

    if (cmd==='solde') {
      const target=options.getMember('membre')||member, eco=getEco(target.id);
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.GOLD).setTitle(`💰 Portefeuille — ${target.displayName}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          {name:'👛 Cash',value:`**${eco.coins.toLocaleString()}** 🪙`,inline:true},
          {name:'🏦 Banque',value:`**${eco.bank.toLocaleString()}** 🪙`,inline:true},
          {name:'💎 Total',value:`**${(eco.coins+eco.bank).toLocaleString()}** 🪙`,inline:true},
          {name:'⭐ Niveau',value:`**${eco.level}**`,inline:true},
          {name:'🔮 XP',value:`**${eco.xp}/${eco.level*100}**`,inline:true},
          {name:'🔥 Streak',value:`**${eco.streak||0}** jours`,inline:true},
          {name:'📈 Total gagné',value:`**${(eco.totalEarned||0).toLocaleString()}** 🪙`,inline:true},
        ).setTimestamp()]});
    }

    if (cmd==='daily') {
      const eco=getEco(user.id), last=eco.lastDaily?new Date(eco.lastDaily):null, now=new Date();
      if (last && now-last < 86400000) return interaction.reply({embeds:[eWarn('Daily',`Déjà réclamé ! Prochain: <t:${ts(new Date(last.getTime()+86400000))}:R>`)]});
      const yesterday = last && (now-last) < 172800000;
      eco.streak = yesterday ? (eco.streak||0)+1 : 1;
      const streakBonus = Math.min(eco.streak*20, 300);
      const hasX2 = (eco.inventory||[]).includes('daily_x2');
      const base = 100 + Math.floor(Math.random()*150);
      const total = (base+streakBonus) * (hasX2?2:1);
      addCoins(user.id,total); eco.lastDaily=now.toISOString(); saveEco();
      return interaction.reply({embeds:[eSuccess('Daily',`+**${total}** 🪙 !\n> Base: **${base}** + Streak: **${streakBonus}** (🔥 ${eco.streak}j)${hasX2?' + x2 Daily':''}\nSolde: **${eco.coins}** 🪙`)]});
    }

    if (cmd==='work') {
      const eco=getEco(user.id), last=eco.lastWork?new Date(eco.lastWork):null, now=new Date();
      if (last && now-last < 3600000) return interaction.reply({embeds:[eWarn('Travail',`Trop tôt ! Prochain: <t:${ts(new Date(last.getTime()+3600000))}:R>`)]});
      const jobs=[
        {name:'développeur',min:60,max:120},{name:'cuisinier',min:40,max:80},
        {name:'streamer',min:50,max:150},{name:'designer',min:70,max:130},
        {name:'trader crypto',min:30,max:200},{name:'YouTubeur',min:80,max:160},
        {name:'data scientist',min:100,max:180},{name:'chauffeur Uber',min:45,max:90},
        {name:'influenceur',min:60,max:250},{name:'hacker éthique',min:120,max:200},
        {name:'médecin',min:150,max:250},{name:'avocat',min:200,max:350},
        {name:'astronaute',min:300,max:500},{name:'plombier',min:50,max:100},
      ];
      const job = jobs[Math.floor(Math.random()*jobs.length)];
      const amount = job.min + Math.floor(Math.random()*(job.max-job.min));
      addCoins(user.id,amount); addXP(user.id,10); eco.lastWork=now.toISOString(); saveEco();
      return interaction.reply({embeds:[eSuccess('Travail',`Tu as bossé comme **${job.name}** → +**${amount}** 🪙\nSolde: **${eco.coins}** 🪙`)]});
    }

    if (cmd==='crime') {
      const eco=getEco(user.id), last=eco.lastCrime?new Date(eco.lastCrime):null, now=new Date();
      if (last && now-last < 7200000) return interaction.reply({embeds:[eWarn('Crime',`Trop risqué ! Prochain: <t:${ts(new Date(last.getTime()+7200000))}:R>`)]});
      const crimes=[
        {name:'cambriolage',win:300,lose:150},{name:'piratage',win:500,lose:200},
        {name:'arnaque à la crypto',win:400,lose:180},{name:'contrebande',win:700,lose:350},
        {name:'faux billets',win:350,lose:200},{name:'braquage',win:800,lose:400},
      ];
      const crime = crimes[Math.floor(Math.random()*crimes.length)];
      const success = Math.random() < 0.5;
      eco.lastCrime = now.toISOString();
      if (success) {
        addCoins(user.id,crime.win); addCasier(user.id,'🔫 Crime',`${crime.name} réussi`,client.user.id); saveEco();
        return interaction.reply({embeds:[eSuccess('Crime réussi 😈',`Tu as fait un **${crime.name}** et gagné **+${crime.win}** 🪙 !\nSolde: **${eco.coins}** 🪙`)]});
      } else {
        const lose = Math.min(eco.coins, crime.lose);
        eco.coins -= lose; addCasier(user.id,'👮 Crime raté',`${crime.name} — amende`,client.user.id); saveEco();
        return interaction.reply({embeds:[eError('Crime raté 👮',`Attrapé lors d'un **${crime.name}** !\nAmende: **-${lose}** 🪙\nSolde: **${eco.coins}** 🪙`)]});
      }
    }

    if (cmd==='rob') {
      const eco=getEco(user.id), last=eco.lastRob?new Date(eco.lastRob):null, now=new Date();
      if (last && now-last < 3600000) return interaction.reply({embeds:[eWarn('Vol',`Cooldown ! Prochain: <t:${ts(new Date(last.getTime()+3600000))}:R>`)]});
      const target = options.getMember('membre');
      if (target.id===user.id) return interaction.reply({embeds:[eError('Vol','Pas de vol de soi-même.')]});
      const ecoT = getEco(target.id);
      if ((ecoT.inventory||[]).some(i=>i==='protection'||i==='rob_shield'))
        return interaction.reply({embeds:[eError('Vol',`${target} est protégé contre le vol ! 🛡️`)]});
      if (ecoT.coins < 50) return interaction.reply({embeds:[eError('Vol',`${target} n'a pas assez (${ecoT.coins} 🪙).`)]});
      const success = Math.random() < 0.45;
      eco.lastRob = now.toISOString();
      if (success) {
        const stolen = Math.floor(ecoT.coins*0.2);
        eco.coins += stolen; ecoT.coins -= stolen;
        addCasier(user.id,'🥷 Vol',`A volé ${stolen} 🪙 à ${target.user.tag}`,client.user.id); saveEco();
        return interaction.reply({embeds:[eSuccess('Vol réussi 🥷',`Tu as volé **${stolen}** 🪙 à ${target} !\nTon solde: **${eco.coins}** 🪙`)]});
      } else {
        const fine = Math.min(eco.coins, 100+Math.floor(Math.random()*200));
        eco.coins -= fine; ecoT.coins += fine;
        addCasier(user.id,'👮 Vol raté',`Tentative sur ${target.user.tag} — amende`,client.user.id); saveEco();
        return interaction.reply({embeds:[eError('Vol raté 👮',`Attrapé en essayant de voler ${target} !\nAmende: **-${fine}** 🪙`)]});
      }
    }

    if (cmd==='pay') {
      const target=options.getMember('membre'), amount=options.getInteger('montant');
      if (target.id===user.id) return interaction.reply({embeds:[eError('Pay','Pas à toi-même !')],ephemeral:true});
      const eco=getEco(user.id), ecoT=getEco(target.id);
      if (eco.coins < amount) return interaction.reply({embeds:[eError('Pay',`Fonds insuffisants (${eco.coins} 🪙)`)],ephemeral:true});
      eco.coins -= amount; ecoT.coins += amount; saveEco();
      return interaction.reply({embeds:[eSuccess('Transfert',`**${amount}** 🪙 envoyés à ${target}.`)]});
    }

    if (cmd==='depot') {
      const eco=getEco(user.id), amount=options.getInteger('montant');
      if (eco.coins < amount) return interaction.reply({embeds:[eError('Dépôt','Fonds insuffisants.')],ephemeral:true});
      eco.coins -= amount; eco.bank += amount; saveEco();
      return interaction.reply({embeds:[eSuccess('Dépôt',`**${amount}** 🪙 déposés. Banque: **${eco.bank}** 🪙`)]});
    }

    if (cmd==='retrait') {
      const eco=getEco(user.id), amount=options.getInteger('montant');
      if (eco.bank < amount) return interaction.reply({embeds:[eError('Retrait','Fonds insuffisants en banque.')],ephemeral:true});
      eco.bank -= amount; eco.coins += amount; saveEco();
      return interaction.reply({embeds:[eSuccess('Retrait',`**${amount}** 🪙 retirés. Cash: **${eco.coins}** 🪙`)]});
    }

    if (cmd==='leaderboard') {
      const sorted = Object.entries(economy)
        .map(([id,d])=>({id,total:(d.coins||0)+(d.bank||0),level:d.level||1,streak:d.streak||0}))
        .sort((a,b)=>b.total-a.total).slice(0,10);
      const med=['🥇','🥈','🥉'];
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.GOLD).setTitle('🏆 Classement Richesse')
        .setDescription(sorted.map((u,i)=>`${med[i]||`\`${i+1}.\``} <@${u.id}> — **${u.total.toLocaleString()}** 🪙 | Nv.**${u.level}** | 🔥${u.streak}j`).join('\n')).setTimestamp()]});
    }

    if (cmd==='shop') {
      const desc = SHOP_ITEMS.map(it=>`**${it.name}** — \`${it.id}\`\n> ${it.desc}\n> 💰 **${it.price.toLocaleString()}** 🪙`).join('\n\n');
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.GOLD).setTitle('🛒 Boutique Evelyaa')
        .setDescription(desc).setFooter({text:'Utilise /acheter <id> pour acheter'}).setTimestamp()]});
    }

    if (cmd==='acheter') {
      const itemId = options.getString('item');
      const item = SHOP_ITEMS.find(i=>i.id===itemId);
      if (!item) return interaction.reply({embeds:[eError('Shop',`Item \`${itemId}\` introuvable. Fais \`/shop\`.`)],ephemeral:true});
      const eco = getEco(user.id);
      if (eco.coins < item.price) return interaction.reply({embeds:[eError('Shop',`Il te faut **${item.price}** 🪙. Tu as **${eco.coins}** 🪙.`)],ephemeral:true});
      eco.coins -= item.price;
      if (!eco.inventory) eco.inventory=[];
      if (itemId==='lottery') {
        const win = Math.random() < 0.2;
        const gain = win ? item.price*5 : 0;
        if (win) { eco.coins += gain; }
        saveEco();
        return interaction.reply({embeds:[win ? eSuccess('🎰 Jackpot!',`Tu gagnes **${gain}** 🪙 ! 🎉`) : eError('🎰 Perdu',`Malchance ! Tu perds tes **${item.price}** 🪙.`)]});
      }
      if (itemId==='mystery_box') {
        const gain = 50 + Math.floor(Math.random()*2950);
        eco.coins += gain; saveEco();
        return interaction.reply({embeds:[eSuccess('📦 Boîte Mystère',`Tu ouvres la boîte et trouves **${gain}** 🪙 !`)]});
      }
      eco.inventory.push(itemId); saveEco();
      return interaction.reply({embeds:[eSuccess('Achat',`Tu as acheté **${item.name}** !\nSolde: **${eco.coins}** 🪙`)]});
    }

    if (cmd==='inventaire') {
      const target=options.getMember('membre')||member, eco=getEco(target.id);
      const inv = eco.inventory||[];
      if (!inv.length) return interaction.reply({embeds:[eInfo('Inventaire',`${target} — inventaire vide.`)]});
      const items = inv.map(id=>{ const it=SHOP_ITEMS.find(s=>s.id===id); return it?`${it.name}`:id; });
      return interaction.reply({embeds:[eInfo(`🎒 Inventaire — ${target.displayName}`, items.join('\n'))]});
    }

    if (cmd==='give-coins') {
      if (!isOwner(user.id)) return interaction.reply({embeds:[eError('Permission','Owner uniquement.')],ephemeral:true});
      addCoins(options.getMember('membre').id, options.getInteger('montant'));
      return interaction.reply({embeds:[eSuccess('Give',`${options.getMember('membre')} reçoit **${options.getInteger('montant')}** 🪙`)]});
    }

    if (cmd==='profil') {
      const target=options.getMember('membre')||member, eco=getEco(target.id);
      const badges=[];
      if (isOwner(target.id)) badges.push('👑 Owner');
      if (isAIAdmin(target.id)) badges.push('🧠 Admin IA');
      if ((eco.inventory||[]).includes('flex_badge')) badges.push('💎 Flex');
      if (eco.level>=10) badges.push('⭐ Vétéran');
      if ((eco.streak||0)>=7) badges.push('🔥 Streak 7j');
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle(`👤 ${target.displayName}`)
        .setThumbnail(target.displayAvatarURL({size:256}))
        .addFields(
          {name:'🪙 Cash',value:`${eco.coins.toLocaleString()}`,inline:true},
          {name:'🏦 Banque',value:`${eco.bank.toLocaleString()}`,inline:true},
          {name:'⭐ Niveau',value:`${eco.level}`,inline:true},
          {name:'🔥 Streak',value:`${eco.streak||0} jours`,inline:true},
          {name:'⚠️ Warns',value:`${(warnings[target.id]||[]).length}`,inline:true},
          {name:'📁 Casier',value:`${getCasier(target.id).length} entrée(s)`,inline:true},
          {name:'🔒 Prison',value:prisons[target.id]?'**Oui**':'Non',inline:true},
          {name:'📅 Rejoint',value:`<t:${ts(target.joinedAt)}:R>`,inline:true},
          {name:'🗓️ Compte',value:`<t:${ts(target.user.createdAt)}:R>`,inline:true},
          {name:'🏅 Badges',value:badges.length?badges.join(' '):'Aucun',inline:false},
        ).setFooter({text:`ID: ${target.id}`}).setTimestamp()]});
    }

    if (cmd==='serverinfo') {
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL())
        .addFields(
          {name:'👑 Owner',value:`<@${guild.ownerId}>`,inline:true},
          {name:'👥 Membres',value:`${guild.memberCount}`,inline:true},
          {name:'📅 Créé',value:`<t:${ts(guild.createdAt)}:R>`,inline:true},
          {name:'💬 Salons',value:`${guild.channels.cache.size}`,inline:true},
          {name:'🎭 Rôles',value:`${guild.roles.cache.size}`,inline:true},
          {name:'😀 Emojis',value:`${guild.emojis.cache.size}`,inline:true},
        ).setFooter({text:`ID: ${guild.id}`}).setTimestamp()]});
    }

    if (cmd==='userinfo') {
      const target=options.getMember('membre')||member;
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.INFO).setTitle(`🧑 ${target.user.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          {name:'🪪 ID',value:target.id,inline:true},
          {name:'🤖 Bot',value:target.user.bot?'Oui':'Non',inline:true},
          {name:'🎭 Rôle top',value:`${target.roles.highest}`,inline:true},
          {name:'📅 Rejoint',value:`<t:${ts(target.joinedAt)}:R>`,inline:true},
          {name:'🗓️ Créé',value:`<t:${ts(target.user.createdAt)}:R>`,inline:true},
        ).setFooter({text:`ID: ${target.id}`}).setTimestamp()]});
    }

    if (cmd==='avatar') {
      const target=options.getMember('membre')||member;
      return interaction.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle(`🖼️ ${target.displayName}`).setImage(target.displayAvatarURL({size:1024}))]});
    }

    if (cmd==='8ball') {
      const r=['Absolument !','Certainement.','Oui !','Probablement.','Peut-être...','Pas sûr.','Essaie plus tard.','Non.','Très improbable.','Certainement pas.','Les astres disent oui.','Mon instinct dit non.'];
      return interaction.reply({embeds:[e('🎱 Boule Magique',`❓ ${options.getString('question')}\n🎱 **${r[Math.floor(Math.random()*r.length)]}**`)]});
    }

    if (cmd==='coin') return interaction.reply({embeds:[e('🪙 Pile ou Face', Math.random()<0.5?'**PILE** 🪙':'**FACE** 🟡')]});

    if (cmd==='dice') {
      const f=options.getInteger('faces')||6;
      return interaction.reply({embeds:[e('🎲 Dé',`D${f} → **${Math.floor(Math.random()*f)+1}**`)]});
    }

    if (cmd==='rps') {
      const choices=['pierre','feuille','ciseaux'], icons={pierre:'🪨',feuille:'📄',ciseaux:'✂️'};
      const p=options.getString('choix'), b=choices[Math.floor(Math.random()*3)];
      const r = p===b?'**Égalité !** 🤝':((p==='pierre'&&b==='ciseaux')||(p==='feuille'&&b==='pierre')||(p==='ciseaux'&&b==='feuille'))?'**Tu gagnes !** 🎉':'**Je gagne !** 😏';
      return interaction.reply({embeds:[e('✂️ RPS',`Toi: ${icons[p]} vs Moi: ${icons[b]}\n\n${r}`)]});
    }

    if (cmd==='ticket') {
      const sub=options.getSubcommand();
      if (sub==='panel') {
        if (!isAdmin(member)) return interaction.reply({embeds:[eError('Permission','Admin requis.')],ephemeral:true});
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tkt_general').setLabel('📩 Général').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('tkt_support').setLabel('🛠️ Support').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('tkt_report').setLabel('⚠️ Signalement').setStyle(ButtonStyle.Danger),
        );
        await channel.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle('🎫 Support Tickets').setDescription('Clique pour ouvrir un ticket !').setFooter({text:guild.name})],components:[row]});
        return interaction.reply({embeds:[eSuccess('Panel','Panel envoyé.')],ephemeral:true});
      }
      if (sub==='close') {
        if (!tickets[channel.id]) return interaction.reply({embeds:[eError('Ticket',"Ce n'est pas un ticket.")],ephemeral:true});
        delete tickets[channel.id]; saveDB('tickets',tickets);
        await interaction.reply({embeds:[e('🔒 Fermeture','Suppression dans 5s...',CONFIG.COLOR.WARNING)]});
        setTimeout(()=>channel.delete().catch(()=>{}),5000);
      }
      if (sub==='add') { const t=options.getMember('membre'); await channel.permissionOverwrites.edit(t,{ViewChannel:true,SendMessages:true}); return interaction.reply({embeds:[eSuccess('Ticket',`${t} ajouté.`)]}); }
      if (sub==='remove') { const t=options.getMember('membre'); await channel.permissionOverwrites.delete(t); return interaction.reply({embeds:[eSuccess('Ticket',`${t} retiré.`)]}); }
    }

    if (cmd==='giveaway') {
      if (!isMod(member)) return interaction.reply({embeds:[eError('Permission','Modérateur requis.')],ephemeral:true});
      const sub=options.getSubcommand();
      if (sub==='start') {
        const dur=parseDuration(options.getString('duree'));
        if (!dur) return interaction.reply({embeds:[eError('Format','Durée invalide.')],ephemeral:true});
        const winners=options.getInteger('gagnants'), prize=options.getString('prix'), end=Date.now()+dur;
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gaw_enter').setLabel('🎉 Participer').setStyle(ButtonStyle.Success));
        const em=new EmbedBuilder().setColor(CONFIG.COLOR.SUCCESS).setTitle(`🎉 GIVEAWAY — ${prize}`)
          .setDescription(`Clique pour participer !\n**Fin:** <t:${Math.floor(end/1000)}:R>\n**Gagnants:** ${winners}\n**Par:** ${user}`)
          .setFooter({text:'0 participants'});
        const msg=await channel.send({embeds:[em],components:[row]});
        giveaways[msg.id]={prize,winners,end,entries:[],channelId:channel.id,guildId:guild.id};
        saveDB('giveaways',giveaways); setTimeout(()=>endGiveaway(msg.id),dur);
        return interaction.reply({embeds:[eSuccess('Giveaway','Giveaway lancé !')],ephemeral:true});
      }
      if (sub==='end') { await endGiveaway(options.getString('message-id')); return interaction.reply({embeds:[eSuccess('Giveaway','Terminé.')],ephemeral:true}); }
      if (sub==='reroll') {
        const g=giveaways[options.getString('message-id')];
        if (!g?.entries.length) return interaction.reply({embeds:[eError('Giveaway','Introuvable.')],ephemeral:true});
        const winner=g.entries[Math.floor(Math.random()*g.entries.length)];
        const ch=client.channels.cache.get(g.channelId); if (ch) ch.send({embeds:[eSuccess('Reroll',`Nouveau gagnant: <@${winner}> 🎉`)]});
        return interaction.reply({embeds:[eSuccess('Reroll',`<@${winner}>`)]});
      }
    }

    if (cmd==='voice') {
      const sub=options.getSubcommand();
      if (sub==='setup') {
        if (!isAdmin(member)) return interaction.reply({embeds:[eError('Permission','Admin requis.')],ephemeral:true});
        if (!serverCfg[guild.id]) serverCfg[guild.id]={};
        serverCfg[guild.id].voiceHub=options.getChannel('salon').id; saveDB('serverconfig',serverCfg);
        return interaction.reply({embeds:[eSuccess('Hub Vocal',`Hub: <#${serverCfg[guild.id].voiceHub}>`)]} );
      }
      const vc=member.voice.channel;
      if (!vc||tempVoice[vc.id]!==user.id) return interaction.reply({embeds:[eError('Vocal','Tu dois être dans ton vocal temporaire.')],ephemeral:true});
      if (sub==='rename') { await vc.setName(options.getString('nom')); return interaction.reply({embeds:[eSuccess('Vocal',`Renommé: **${options.getString('nom')}**`)]}); }
      if (sub==='limit')  { await vc.setUserLimit(options.getInteger('limite')); return interaction.reply({embeds:[eSuccess('Vocal',`Limite: **${options.getInteger('limite')}**`)]}); }
      if (sub==='lock')   { await vc.permissionOverwrites.edit(guild.roles.everyone,{Connect:false}); return interaction.reply({embeds:[e('🔒 Vocal verrouillé','Personne ne peut entrer.',CONFIG.COLOR.WARNING)]}); }
      if (sub==='unlock') { await vc.permissionOverwrites.edit(guild.roles.everyone,{Connect:null}); return interaction.reply({embeds:[eSuccess('Vocal ouvert','Tout le monde peut entrer.')]}); }
    }

  } catch(err) {
    console.error(`❌ /${cmd}:`, err);
    const msg = {embeds:[eError('Erreur',`\`${err.message}\``)]};
    if (interaction.deferred) interaction.editReply(msg).catch(()=>{});
    else interaction.reply({...msg,ephemeral:true}).catch(()=>{});
  }
}

// ─────────────────────────────────────────────
//  BUTTON HANDLER
// ─────────────────────────────────────────────
async function handleButton(interaction) {
  const {customId, guild, user, channel} = interaction;

  if (customId.startsWith('tkt_') && customId!=='tkt_close_btn') {
    const typeMap={tkt_general:'📩 Général',tkt_support:'🛠️ Support',tkt_report:'⚠️ Signalement'};
    const existing = guild.channels.cache.find(c=>c.name===`ticket-${user.username.toLowerCase()}`);
    if (existing) return interaction.reply({embeds:[eWarn('Ticket',`Tu as déjà un ticket: ${existing}`)],ephemeral:true});
    const ch = await guild.channels.create({
      name:`ticket-${user.username.toLowerCase()}`, type:ChannelType.GuildText,
      permissionOverwrites:[
        {id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},
        {id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]},
      ],
      parent:channel.parentId,
    });
    tickets[ch.id]={userId:user.id,guildId:guild.id,subject:typeMap[customId]}; saveDB('tickets',tickets);
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tkt_close_btn').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger));
    await ch.send({content:`${user}`, embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY).setTitle('🎫 Ticket ouvert').setDescription(`Bienvenue ${user} !\n**Sujet:** ${typeMap[customId]}`)], components:[row]});
    return interaction.reply({embeds:[eSuccess('Ticket',`Créé: ${ch}`)],ephemeral:true});
  }
  if (customId==='tkt_close_btn') {
    if (!tickets[channel.id]) return;
    delete tickets[channel.id]; saveDB('tickets',tickets);
    await interaction.reply({embeds:[e('🔒 Fermeture','Suppression dans 5s...',CONFIG.COLOR.WARNING)]});
    setTimeout(()=>channel.delete().catch(()=>{}),5000);
  }
  if (customId==='gaw_enter') {
    const gaw = Object.entries(giveaways).find(([,g])=>g.channelId===channel.id);
    if (!gaw) return interaction.reply({embeds:[eError('Giveaway','Introuvable.')],ephemeral:true});
    const [,g] = gaw;
    if (g.entries.includes(user.id)) {
      g.entries = g.entries.filter(id=>id!==user.id); saveDB('giveaways',giveaways);
      return interaction.reply({embeds:[eInfo('Giveaway','Tu t\'es retiré.')],ephemeral:true});
    }
    g.entries.push(user.id); saveDB('giveaways',giveaways);
    return interaction.reply({embeds:[eSuccess('Giveaway','Inscrit ! 🎉')],ephemeral:true});
  }
}

// ─────────────────────────────────────────────
//  MESSAGE EVENTS
// ─────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const blocked = await runAutoMod(message);
  if (blocked) return;

  // XP passif à chaque message
  const levelUp = addXP(message.author.id, 5);
  if (levelUp) {
    const eco=getEco(message.author.id), reward=eco.level*50;
    addCoins(message.author.id, reward);
    const m = await message.channel.send({embeds:[eSuccess('Level Up !',`${message.author} → Niveau **${eco.level}** 🎉 +**${reward}** 🪙`)]});
    setTimeout(()=>m.delete().catch(()=>{}), 10000);
  }

  const lower = message.content.toLowerCase().trim();

  // ── TRIGGER "evelyaa ..." ─────────────────────────────────
  // Exemples: "evelyaa enlève-lui le rôle" / "evelyaa c'est quoi le XP?"
  if (lower.startsWith(CONFIG.TRIGGER)) {
    const question = message.content.slice(CONFIG.TRIGGER.length).trim();
    if (!question) {
      return message.reply({embeds:[eInfo('Evelyaa 🤖',`Pose-moi une question après **${CONFIG.TRIGGER}** !\nEx: \`${CONFIG.TRIGGER} comment fonctionne l'économie ?\``)]});
    }
    if (!CONFIG.AI_KEY || CONFIG.AI_KEY==='VOTRE_CLE_IA_ICI') return;
    await message.channel.sendTyping();
    try {
      const reply = await askAI(message.author.id, question, message.guild.id);
      await message.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY)
        .setDescription(reply.substring(0,4096))
        .setFooter({text:`${AI_MODES[aiModes[message.guild.id]?.mode||'assistant'].name} • Evelyaa`})
        .setTimestamp()]});
    } catch(err) { message.reply({embeds:[eError('Evelyaa',err.message)]}); }
    return;
  }

  // Mention directe du bot
  if (message.mentions.has(client.user) && !message.mentions.everyone) {
    const q = message.content.replace(`<@${client.user.id}>`,'').trim();
    if (!q) return message.reply({embeds:[eInfo('Evelyaa 🤖',`Écris \`${CONFIG.TRIGGER} ta question\` ou mentionne-moi avec une question !`)]});
    if (!CONFIG.AI_KEY || CONFIG.AI_KEY==='VOTRE_CLE_IA_ICI') return;
    await message.channel.sendTyping();
    try {
      const reply = await askAI(message.author.id, q, message.guild.id);
      await message.reply({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.PRIMARY)
        .setDescription(reply.substring(0,4096))
        .setFooter({text:`${AI_MODES[aiModes[message.guild.id]?.mode||'assistant'].name} • Evelyaa`})
        .setTimestamp()]});
    } catch(err) { message.reply({embeds:[eError('Evelyaa',err.message)]}); }
  }
});

// ─────────────────────────────────────────────
//  GUILD EVENTS
// ─────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
  const ch = member.guild.channels.cache.get(serverCfg[member.guild.id]?.welcomeCh); if (!ch) return;
  ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.SUCCESS).setTitle('👋 Bienvenue !')
    .setDescription(`Bienvenue sur **${member.guild.name}**, ${member} !\nTu es le **${member.guild.memberCount}ème** membre 🎉`)
    .setThumbnail(member.displayAvatarURL({size:256})).setTimestamp()]});
});
client.on('guildMemberRemove', async member => {
  const ch = member.guild.channels.cache.get(serverCfg[member.guild.id]?.logCh); if (!ch) return;
  ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.WARNING).setTitle('👋 Départ')
    .setDescription(`**${member.user.tag}** a quitté.\nMembre depuis: <t:${ts(member.joinedAt)}:R>`).setThumbnail(member.displayAvatarURL()).setTimestamp()]});
});
client.on('messageDelete', async message => {
  if (!message.guild || message.author?.bot || !message.content) return;
  const ch = message.guild.channels.cache.get(serverCfg[message.guild.id]?.logCh); if (!ch) return;
  ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.WARNING).setTitle('🗑️ Message Supprimé')
    .addFields({name:'Auteur',value:message.author?.tag||'?',inline:true},{name:'Salon',value:`${message.channel}`,inline:true},{name:'Contenu',value:message.content.substring(0,1024)}).setTimestamp()]});
});
client.on('messageUpdate', async (o, n) => {
  if (!o.guild || o.author?.bot || o.content===n.content) return;
  const ch = o.guild.channels.cache.get(serverCfg[o.guild.id]?.logCh); if (!ch) return;
  ch.send({embeds:[new EmbedBuilder().setColor(CONFIG.COLOR.INFO).setTitle('✏️ Message Modifié')
    .addFields({name:'Auteur',value:o.author?.tag||'?',inline:true},{name:'Salon',value:`${o.channel}`,inline:true},{name:'Avant',value:o.content?.substring(0,512)||'?'},{name:'Après',value:n.content?.substring(0,512)||'?'}).setTimestamp()]});
});

// ─────────────────────────────────────────────
//  VOCAL TEMP
// ─────────────────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild||oldState.guild;
  if (oldState.channelId && tempVoice[oldState.channelId]) {
    const ch = guild.channels.cache.get(oldState.channelId);
    if (ch && ch.members.size===0) { delete tempVoice[oldState.channelId]; saveDB('tempvoice',tempVoice); ch.delete().catch(()=>{}); }
  }
  const cfg = serverCfg[guild.id];
  if (newState.channelId && cfg?.voiceHub===newState.channelId) {
    const mb = newState.member;
    const vc = await guild.channels.create({
      name:`🎤 ${mb.displayName}`, type:ChannelType.GuildVoice,
      parent:newState.channel.parentId, userLimit:0,
      permissionOverwrites:[{id:mb.id,allow:[PermissionFlagsBits.ManageChannels,PermissionFlagsBits.MoveMembers]}],
    });
    tempVoice[vc.id]=mb.id; saveDB('tempvoice',tempVoice);
    await mb.voice.setChannel(vc).catch(()=>{});
  }
});

// ─────────────────────────────────────────────
//  PRISON LOOP
// ─────────────────────────────────────────────
setInterval(async () => {
  for (const [uid,data] of Object.entries(prisons)) {
    if (data.until && Date.now() >= data.until) {
      const guild = client.guilds.cache.get(data.guildId);
      if (guild) await releaseUser(guild, uid, 'Peine accomplie');
    }
  }
}, 30000);

// ─────────────────────────────────────────────
//  READY
// ─────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  ✅  ${client.user.tag}`);
  console.log(`║  👑  Owner: ${CONFIG.OWNER_ID}`);
  console.log(`║  🧠  Admin IA: ${CONFIG.AI_ADMIN}`);
  console.log(`║  📡  Serveurs: ${client.guilds.cache.size}`);
  console.log(`║  🔑  Trigger: "${CONFIG.TRIGGER}"`);
  console.log(`║  💾  Données persistantes: ${CONFIG.DB_PATH}`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  client.user.setPresence({
    activities:[{name:`${CONFIG.TRIGGER} <question> 🤖`, type:3}],
    status:'online',
  });
  await registerCommands();
});
client.on('error', err => console.error('Client error:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

client.login(CONFIG.TOKEN);
