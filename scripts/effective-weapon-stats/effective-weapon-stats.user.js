// ==UserScript==
// @name         Effective Weapon Stats
// @namespace    torn-userscripts
// @version      5.0.2
// @description  Calculates effective Torn weapon stats on the item page using visible item data plus your Torn API perks, education, and merits.
// @author       DadGum (based on work by BakedPotato [2889448])
// @license      MIT
// @match        https://www.torn.com/item.php*
// @updateURL    https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/effective-weapon-stats/effective-weapon-stats.user.js
// @downloadURL  https://raw.githubusercontent.com/db7346/torn-userscripts/main/scripts/effective-weapon-stats/effective-weapon-stats.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

/*
 * PURPOSE
 *   Shows effective damage, accuracy, and crit chance when you open a weapon on
 *   the item page. Read-only helper: it never clicks or submits anything.
 *
 * CREDITS AND LICENSE
 *   Based on Torn Effective Weapon Stats v4.9.0 by BakedPotato [2889448] (MIT).
 *   Released under the MIT license. The MIT permission notice is in this
 *   repository's LICENSE file.
 *
 * API KEY USAGE DISCLOSURE
 *   Data storage:        Key, computed bonuses, merit names, and ammo state, locally in Tampermonkey storage.
 *   Data sharing:        None. Requests go only to api.torn.com.
 *   Purpose of use:      Including your own education, merit, and perk bonuses in the weapon stats.
 *   Key storage/sharing: Stored locally, sent only in the Authorization header to api.torn.com, never logged.
 *   Key access level:    Minimal Access.
 *
 * API CALLS
 *   GET /v2/user?selections=education,job,merits,perks  Minimal  Every 12 hours or on Refresh
 *   GET /v2/torn/merits                                 Public   Every 7 days
 *   GET /v2/key/info                                    Any      Only when saving a key
 *   Requests are tagged comment=EffectiveWeaponStats. Failures wait 5 minutes before retrying.
 *
 * CHANGELOG
 *   5.0.2  The key field no longer triggers the browser's save password prompt.
 *   5.0.1  Specialist now counts toward Effective Damage, per the Torn wiki.
 *   5.0.0  Moved to one Torn API v2 request sent with the Authorization header.
 *          Keeps the last good bonuses when the API fails, with a retry cooldown.
 *          The page observer now starts before the API call and ignores unrelated changes.
 *          The key moved to Tampermonkey storage and a Settings panel.
 *          Tightened selectors, removed PDA support, and restructured the script.
 *   4.9.0  Original release by BakedPotato.
 */

(function () {
    "use strict";

    // =========================================================================
    // CONFIG
    // =========================================================================

    const CONFIG = Object.freeze({
        DEBUG: false,
        API_BASE: "https://api.torn.com/v2",
        API_COMMENT: "EffectiveWeaponStats",
        USER_SELECTIONS: "education,job,merits,perks",
        STORAGE_PREFIX: "tms_ews_",
        STORAGE_KEYS: Object.freeze({
            API_KEY: "api_key",
            API_BONUS: "api_bonus",
            MERIT_NAMES: "merit_names",
            AMMO: "ammo",
            BREAKDOWN_OPEN: "breakdown_open",
            FAILURE: "api_failure",
            SETTINGS_SHOWN: "settings_shown",
            BAD_KEY_PROMPT: "bad_key_prompt",
        }),
        // Written by v4.x in the page's localStorage. Moved or removed once.
        LEGACY_API_KEY: "torn_weaponstats_api_key_v46",
        LEGACY_STORAGE_KEYS: Object.freeze([
            "torn_weaponstats_api_key_v46",
            "torn_weaponstats_api_bonus_cache_v490",
            "torn_weaponstats_ammo_cache_v46",
            "torn_weaponstats_breakdown_open_v464",
        ]),
        TTL: Object.freeze({
            API_BONUS_MS: 12 * 60 * 60 * 1000,
            MERIT_NAMES_MS: 7 * 24 * 60 * 60 * 1000,
            AMMO_MS: 30 * 60 * 1000,
            AMMO_RECONFIRM_MS: 60 * 1000,
            FAILURE_COOLDOWN_MS: 5 * 60 * 1000,
        }),
        RATE_LIMIT: Object.freeze({ MAX_CALLS: 50, WINDOW_MS: 60 * 1000 }),
        REQUEST_TIMEOUT_MS: 20000,
        UPDATE_DELAY_MS: 120,
        BASE_CRIT_RATE: 12,
        IDS: Object.freeze({
            BOX: "tms-ews-box",
            BREAKDOWN: "tms-ews-breakdown",
            SETTINGS: "tms-ews-settings",
        }),
        // Torn's hashed suffixes change between builds, so these match only the
        // stable prefix, including the "___" that ends it.
        SELECTORS: Object.freeze({
            DETAIL_PANEL: "li.show-item-info",
            PROPERTIES_LIST: "li.show-item-info ul[class*='properties___']",
            PREVIEW_WRAPPER: "li.show-item-info [class*='previewAndPropertiesWrapper___']",
            WEAPON_ROW: "li[data-armoryid][data-item][data-category]",
            OPENED_ROW: "#primary-items > li.opened[data-armoryid], #secondary-items > li.opened[data-armoryid], #melee-items > li.opened[data-armoryid], #temporary-items > li.opened[data-armoryid]",
            ROW_NAME: ".name",
            ROW_ARIA_NAME: ".thumbnail-wrap[aria-label]",
            DESCRIPTION: "[class*='description___']",
            PROPERTY_TITLE: "[class*='title___']",
            PROPERTY_VALUE_WRAPPER: "[class*='valueWrapper___']",
            PROPERTY_VALUE: "[class*='valueWrapper___'] [aria-hidden='true']",
            LEGACY_PROPERTY_VALUE: ".desc",
            MOD_CONTAINER_FALLBACK: "li.bonus.left.testtest",
            LOADOUT_CURRENT: "#loadoutsRoot [class*='currentSlot___']",
            LOADOUT_REVIEW: "[class*='itemReview___']",
            LOADOUT_IMAGE: "img[alt]",
            LOADOUT_AMMO: "[class*='ammo___']",
            LOADOUT_AMMO_TEXT: "[class*='ammoDescription___']",
            LOADOUT_TYPE: "[class*='type___']",
            WATCH_SCOPE: "li.show-item-info, #loadoutsRoot",
        }),
        OBSERVED_ATTRIBUTES: Object.freeze(["aria-label", "class"]),
        API_ERROR_MESSAGES: Object.freeze({
            1: "No API key was sent. Open Settings and enter your key.",
            2: "Your API key is incorrect. Open Settings and enter it again.",
            5: "Torn's API rate limit was reached. The script will try again later.",
            8: "Torn has temporarily blocked this IP address from the API.",
            9: "Torn's API is currently disabled.",
            10: "The API key owner is in federal jail.",
            11: "This key was changed too recently. Try again in a moment.",
            12: "Torn could not read this API key. Try again shortly.",
            13: "This API key is temporarily disabled.",
            14: "This key has reached its daily read limit.",
            16: "This API key's access level is too low. Use a key with at least Minimal Access.",
            17: "Torn's API had a backend error. Try again shortly.",
            18: "This API key is paused by its owner.",
            24: "This API endpoint is temporarily closed.",
        }),
    });

    // Game rules and bonus tables

    const RANGED_CATEGORIES = ["rifle", "pistol", "smg", "shotgun", "machinegun", "heavyartillery"];

    const MELEE_CATEGORIES = ["slashing", "piercing", "clubbing", "mechanical", "melee"];

    const SUPPORTED_CATEGORIES = [
        "global",
        "rifle",
        "pistol",
        "smg",
        "shotgun",
        "machinegun",
        "heavyartillery",
        "slashing",
        "piercing",
        "clubbing",
        "mechanical",
        "melee",
        "temporary"
    ];

    const JAPANESE_BLADE_WEAPONS = new Set([
        "dual samurai swords",
        "kama",
        "katana",
        "kodachi",
        "sai",
        "samurai sword",
        "yasukuni sword"
    ]);

    /*
        Weapon bonus registry
        ------------------------------------------------------------
        Sources reviewed 2026-10-29:
        https://wiki.torn.com/wiki/Weapon_Bonus
        https://wiki.torn.com/wiki/Merit
        https://wiki.torn.com/wiki/Ammo
        https://wiki.torn.com/wiki/Weapon_Mod
        https://wiki.torn.com/wiki/Education:Perks
        https://wiki.torn.com/wiki/Damage_Revamp_(2021)

        A badge value is not automatically a damage percentage. Depending on
        the bonus it can mean damage, proc chance, turns, a life threshold,
        armor bypass, healing, a stat modifier, or a reward modifier.

        scenario.kind values:
        - additive: adds the badge value to Torn's additive damage-bonus pool
        - fixedAdditive: adds a fixed percentage supplied by the effect
        - multiplier: multiplies the already-adjusted effective-damage stat
        - multiHit: shows a range based on a number of full-strength hits
    */
    const WEAPON_BONUS_REGISTRY = Object.freeze({
        achilles: {
            name: "Achilles",
            group: "Location damage",
            summary: "+{value}% foot damage",
            scenario: { kind: "additive", label: "Foot-hit Effective Damage", location: "foot", locationMultiplier: 0.7 }
        },
        assassinate: {
            name: "Assassinate",
            group: "Conditional damage",
            summary: "+{value}% damage on the first turn",
            scenario: { kind: "additive", label: "First-turn Effective Damage" }
        },
        backstab: {
            name: "Backstab",
            group: "Proc damage",
            summary: "{value}% chance to deal double damage while the opponent is distracted",
            scenario: { kind: "multiplier", label: "Backstab Proc Potential", multiplier: 2 }
        },
        berserk: {
            name: "Berserk",
            group: "Damage / hit-chance tradeoff",
            summary: "+{value}% damage; -{half}% hit chance",
            unconditionalDamageFactor: 1,
            hitChanceFactor: -0.5
        },
        bleed: {
            name: "Bleed",
            group: "Damage over time",
            summary: "{value}% chance to apply a 9-turn Bleed damage-over-time effect"
        },
        blindside: {
            name: "Blindside",
            group: "Conditional damage",
            summary: "+{value}% damage while the target is at full life",
            scenario: { kind: "additive", label: "Full-life Target Effective Damage" }
        },
        bloodlust: {
            name: "Bloodlust",
            group: "Healing",
            summary: "Regenerates life equal to {value}% of life removed"
        },
        comeback: {
            name: "Comeback",
            group: "Conditional damage",
            summary: "+{value}% damage while below 25% life",
            scenario: { kind: "additive", label: "Low-life Effective Damage" }
        },
        conserve: {
            name: "Conserve",
            group: "Ammo",
            summary: "+{value}% ammo conservation"
        },
        cripple: {
            name: "Cripple",
            group: "Enemy debuff",
            summary: "{value}% chance to reduce Dexterity by 25% (up to 3 stacks)"
        },
        crusher: {
            name: "Crusher",
            group: "Location damage",
            summary: "+{value}% head damage",
            scenario: { kind: "additive", label: "Head-hit Effective Damage", location: "head", locationMultiplier: 3.5 }
        },
        cupid: {
            name: "Cupid",
            group: "Location damage",
            summary: "+{value}% heart damage",
            scenario: { kind: "additive", label: "Heart-hit Effective Damage", location: "heart", locationMultiplier: 3.5 }
        },
        deadeye: {
            name: "Deadeye",
            group: "Critical damage",
            summary: "+{value}% damage on critical hits",
            scenario: { kind: "additive", label: "Deadeye Critical-hit Damage Potential", critical: true, locationMultiplier: 3.5 }
        },
        deadly: {
            name: "Deadly",
            group: "Proc damage",
            summary: "{value}% chance to deal +500% damage",
            scenario: { kind: "fixedAdditive", label: "Deadly-hit Effective Damage", extraPct: 500 }
        },
        disarm: {
            name: "Disarm",
            group: "Enemy debuff",
            summary: "Disables the struck hand/arm weapon for {value} turns; unavailable on the first attacking turn"
        },
        doubleedged: {
            name: "Double-edged",
            group: "Proc damage",
            summary: "{value}% chance to deal double damage and injure yourself",
            scenario: { kind: "multiplier", label: "Double-edged Proc Potential", multiplier: 2 }
        },
        doubletap: {
            name: "Double Tap",
            group: "Multi-hit",
            summary: "{value}% chance to attack twice in one turn",
            scenario: { kind: "multiHit", label: "Double Tap Two-hit Potential", minHits: 2, maxHits: 2 }
        },
        empower: {
            name: "Empower",
            group: "Passive battle stat",
            summary: "+{value}% Strength while using this weapon"
        },
        eviscerate: {
            name: "Eviscerate",
            group: "Enemy debuff",
            summary: "Target receives +{value}% damage after Eviscerate is applied",
            scenario: { kind: "additive", label: "Eviscerated-target Effective Damage" }
        },
        execute: {
            name: "Execute",
            group: "Finisher",
            summary: "Instantly defeats a non-NPC target below {value}% life on a damaging first action"
        },
        expose: {
            name: "Expose",
            group: "Critical chance",
            summary: "+{value}% critical-hit rate",
            critRateFactor: 1
        },
        finale: {
            name: "Finale",
            group: "Scaling damage",
            summary: "+{value}% damage for each turn this weapon is not used"
        },
        focus: {
            name: "Focus",
            group: "Hit chance",
            summary: "+{value}% hit chance for every successive miss"
        },
        frenzy: {
            name: "Frenzy",
            group: "Scaling damage / accuracy",
            summary: "+{value}% damage and hit chance on each successive hit"
        },
        fury: {
            name: "Fury",
            group: "Multi-hit",
            summary: "{value}% chance to hit twice in one turn",
            scenario: { kind: "multiHit", label: "Fury Two-hit Potential", minHits: 2, maxHits: 2 }
        },
        grace: {
            name: "Grace",
            group: "Damage / hit-chance tradeoff",
            summary: "+{value}% hit chance; -{half}% damage",
            unconditionalDamageFactor: -0.5,
            hitChanceFactor: 1
        },
        homerun: {
            name: "Home Run",
            group: "Defense",
            summary: "{value}% chance to deflect an incoming temporary item"
        },
        irradiate: {
            name: "Irradiate",
            group: "Finisher debuff",
            summary: "Applies radiation poisoning when used for the finishing hit"
        },
        motivation: {
            name: "Motivation",
            group: "Self buff",
            summary: "{value}% chance to increase all battle stats by 10% (up to 5 stacks)"
        },
        paralyze: {
            name: "Paralyze",
            group: "Enemy debuff",
            summary: "{value}% chance to apply a 300-second effect giving the target a 50% chance to miss turns"
        },
        parry: {
            name: "Parry",
            group: "Defense",
            summary: "{value}% chance to block incoming melee attacks"
        },
        penetrate: {
            name: "Penetrate",
            group: "Armor bypass",
            summary: "Ignores {value}% of enemy armor mitigation"
        },
        plunder: {
            name: "Plunder",
            group: "Finisher reward",
            summary: "+{value}% money mugged when used for the finishing hit"
        },
        powerful: {
            name: "Powerful",
            group: "Damage",
            summary: "+{value}% damage on every hit",
            unconditionalDamageFactor: 1
        },
        proficience: {
            name: "Proficience",
            group: "Finisher reward",
            summary: "+{value}% weapon experience when used for the finishing hit"
        },
        puncture: {
            name: "Puncture",
            group: "Armor bypass",
            summary: "{value}% chance to ignore armor and defensive bonuses"
        },
        quicken: {
            name: "Quicken",
            group: "Passive battle stat",
            summary: "+{value}% Speed while using this weapon"
        },
        rage: {
            name: "Rage",
            group: "Multi-hit",
            summary: "{value}% chance to hit 2–8 times in one turn",
            scenario: { kind: "multiHit", label: "Rage Multi-hit Potential", minHits: 2, maxHits: 8 }
        },
        revitalize: {
            name: "Revitalize",
            group: "Finisher utility",
            summary: "{value}% chance to restore the attack energy on the finishing hit"
        },
        roshambo: {
            name: "Roshambo",
            group: "Location damage",
            summary: "+{value}% groin damage",
            scenario: { kind: "additive", label: "Groin-hit Effective Damage", location: "groin", locationMultiplier: 2 }
        },
        slow: {
            name: "Slow",
            group: "Enemy debuff",
            summary: "{value}% chance to reduce Speed by 25% (up to 3 stacks)"
        },
        smurf: {
            name: "Smurf",
            group: "Target-dependent damage",
            summary: "+{value}% damage per level the opponent is above you"
        },
        specialist: {
            name: "Specialist",
            group: "Damage",
            summary: "+{value}% damage, but the weapon is limited to one clip",
            unconditionalDamageFactor: 1
        },
        stricken: {
            name: "Stricken",
            group: "Finisher effect",
            summary: "+{value}% hospital time when used for the finishing hit"
        },
        stun: {
            name: "Stun",
            group: "Enemy debuff",
            summary: "{value}% chance to make the opponent miss their next turn"
        },
        suppress: {
            name: "Suppress",
            group: "Enemy debuff",
            summary: "{value}% chance to apply a 25% chance of missing future turns"
        },
        sureshot: {
            name: "Sure Shot",
            group: "Hit chance",
            summary: "{value}% chance of a guaranteed hit"
        },
        throttle: {
            name: "Throttle",
            group: "Location damage",
            summary: "+{value}% throat damage",
            scenario: {
                kind: "additive",
                label: "Throttle Throat-hit Damage Potential",
                location: "throat",
                locationMultiplier: 3.5,
                includeThroatEducation: true
            }
        },
        warlord: {
            name: "Warlord",
            group: "Finisher reward",
            summary: "+{value}% respect on the finishing hit"
        },
        weaken: {
            name: "Weaken",
            group: "Enemy debuff",
            summary: "{value}% chance to reduce Defense by 25% (up to 3 stacks)"
        },
        windup: {
            name: "Wind-up",
            group: "Conditional damage",
            summary: "+{value}% damage after spending a turn winding up",
            scenario: { kind: "additive", label: "Wound-up Effective Damage" }
        },
        wither: {
            name: "Wither",
            group: "Enemy debuff",
            summary: "{value}% chance to reduce Strength by 25% (up to 3 stacks)"
        },

        // Unique / fixed-weapon bonuses
        blindfire: {
            name: "Blindfire",
            group: "Unique multi-action",
            summary: "{value}% chance to expend the remaining clip in one turn; -5.00 accuracy after each successful action"
        },
        burn: {
            name: "Burn",
            group: "Unique damage over time",
            summary: "{value}% chance to apply a 3-turn Burning damage-over-time effect"
        },
        demoralized: {
            name: "Demoralized",
            group: "Unique enemy debuff",
            summary: "{value}% chance to reduce all opponent battle stats by 10% (up to 5 stacks)"
        },
        emasculate: {
            name: "Emasculate",
            group: "Unique finisher reward",
            summary: "Gain {value}% of maximum happiness on the finishing hit"
        },
        freeze: {
            name: "Freeze",
            group: "Unique enemy debuff",
            summary: "{value}% chance to reduce enemy Speed and Dexterity by 50%"
        },
        hazardous: {
            name: "Hazardous",
            group: "Unique self-damage",
            summary: "Receive self-damage equal to {value}% of damage dealt"
        },
        laceration: {
            name: "Laceration",
            group: "Unique damage over time",
            summary: "{value}% chance to apply a 9-turn Laceration damage-over-time effect"
        },
        poisoned: {
            name: "Poisoned",
            group: "Unique damage over time",
            summary: "{value}% chance to apply a 19-turn Poisoned damage-over-time effect"
        },
        severeburning: {
            name: "Severe Burning",
            group: "Unique damage over time",
            summary: "{value}% chance to apply a 3-turn Severe Burning damage-over-time effect"
        },
        shock: {
            name: "Shock",
            group: "Unique enemy debuff",
            summary: "{value}% chance to make the opponent miss the next turn"
        },
        sleep: {
            name: "Sleep",
            group: "Unreleased enemy debuff",
            summary: "Makes the opponent miss turns until they receive damage"
        },
        smash: {
            name: "Smash",
            group: "Unique damage",
            summary: "Deals double damage, then requires a recharge turn",
            scenario: { kind: "multiplier", label: "Smash-hit Effective Damage", multiplier: 2 }
        },
        spray: {
            name: "Spray",
            group: "Unique proc damage",
            summary: "{value}% chance to empty a full clip for double damage",
            scenario: { kind: "multiplier", label: "Spray Proc Potential", multiplier: 2 }
        },
        storage: {
            name: "Storage",
            group: "Unique utility",
            summary: "Allows a second temporary item to be withdrawn during a fight"
        },
        toxin: {
            name: "Toxin",
            group: "Unique enemy debuff",
            summary: "{value}% chance to reduce one random battle stat by 25% (up to 3 stacks per stat)"
        }
    });

    const WEAPON_BONUS_PARSE_ALIASES = Object.freeze({
        "Beserk": "berserk",
        "Blind Fire": "blindfire",
        "Burning": "burn",
        "Dead Eye": "deadeye",
        "Demoralize": "demoralized",
        "Double edged": "doubleedged",
        "DoubleTap": "doubletap",
        "HomeRun": "homerun",
        "Lacerate": "laceration",
        "Paralyzed": "paralyze",
        "Poison": "poisoned",
        "Proficiency": "proficience",
        "Severe Burn": "severeburning",
        "SevereBurning": "severeburning",
        "SureShot": "sureshot",
        "Wind up": "windup",
        "Windup": "windup"
    });

    const WEAPON_BONUS_PARSE_NAMES = Object.freeze([
        ...Object.values(WEAPON_BONUS_REGISTRY).map((definition) => definition.name),
        ...Object.keys(WEAPON_BONUS_PARSE_ALIASES)
    ].sort((a, b) => b.length - a.length));

    const WEAPON_BONUS_NAME_PATTERN = WEAPON_BONUS_PARSE_NAMES
        .map((name) =>
            name
                .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                .replace(/\s+/g, "\\s*")
        )
        .join("|");

    const AMMO_DAMAGE_PCT = {
        incendiary: 40,
        hollowpoint: 50
    };

    const AMMO_ACCURACY_FLAT = {
        tracer: 10
    };

    const CATEGORY_ALIASES = [
        { re: /\bslashing weapon(s)?\b|\bslashing\b/, cat: "slashing" },
        { re: /\bpiercing weapon(s)?\b|\bpiercing\b/, cat: "piercing" },
        { re: /\bclubbing weapon(s)?\b|\bclub\b|\bclubbing\b/, cat: "clubbing" },
        { re: /\bmechanical weapon(s)?\b|\bmechanical\b/, cat: "mechanical" },
        { re: /\bmelee weapon(s)?\b|\bmelee\b/, cat: "melee" },
        { re: /\brifle(s)?\b|\brifle weapon(s)?\b/, cat: "rifle" },
        { re: /\bpistol(s)?\b|\bpistol weapon(s)?\b/, cat: "pistol" },
        { re: /\bshotgun(s)?\b|\bshotgun weapon(s)?\b/, cat: "shotgun" },
        { re: /\bsmg(s)?\b|\bsubmachine\b|\bsubmachine gun(s)?\b/, cat: "smg" },
        { re: /\btemporary weapon(s)?\b|\btemporary\b/, cat: "temporary" },
        { re: /\bmachine[- ]?guns?\b/, cat: "machinegun" },
        { re: /\bheavy[- ]artillery\b/, cat: "heavyartillery" },
        { re: /\bfist\b/, cat: "unsupported_fist" },
        { re: /\bthroat\b/, cat: "unsupported_throat" }
    ];

    const EDUCATION_BONUSES = [
        { courseId: 35, source: "Education BIO2350 — Evolution", damagePct: 1, categories: ["global"] },
        { courseId: 41, source: "Education BIO2410 — Anatomy", critRatePct: 3, categories: ["global"] },
        { courseId: 38, source: "Education BIO2380 — Fundamentals of Neurobiology", damagePct: 10, categories: ["throat"] },
        { courseId: 16, source: "Education HIS2160 — Ancient Japanese History", damagePct: 10, categories: ["japaneseBlade"] },
        { courseId: 17, source: "Education HIS2170 — Medieval History", damagePct: 2, categories: ["melee"] },
        { courseId: 82, source: "Education CBT2820 — Study of Machine Guns", accuracyFlat: 1, categories: ["machinegun"] },
        { courseId: 83, source: "Education CBT2830 — Study of Submachine Guns", accuracyFlat: 1, categories: ["smg"] },
        { courseId: 84, source: "Education CBT2840 — Study of Pistols", accuracyFlat: 1, categories: ["pistol"] },
        { courseId: 85, source: "Education CBT2850 — Study of Rifles", accuracyFlat: 1, categories: ["rifle"] },
        { courseId: 86, source: "Education CBT2860 — Study of Heavy Artillery", accuracyFlat: 1, categories: ["heavyartillery"] },
        { courseId: 125, source: "Education CBT2125 — Study of Shotguns", accuracyFlat: 1, categories: ["shotgun"] },
        { courseId: 116, source: "Education GEN2116 — General Mechanics", hitChancePct: 5, categories: ["temporary"] },
        { courseId: 119, source: "Education GEN2119 — General Science", damagePct: 5, categories: ["temporary"] }
    ];

    const MERIT_CATEGORY_PATTERNS = [
        { re: /rifle/i, category: "rifle" },
        { re: /pistol/i, category: "pistol" },
        { re: /\bsmg\b|submachine/i, category: "smg" },
        { re: /shotgun/i, category: "shotgun" },
        { re: /machine[ -]?gun/i, category: "machinegun" },
        { re: /heavy[ -]artillery/i, category: "heavyartillery" },
        { re: /slashing/i, category: "slashing" },
        { re: /piercing/i, category: "piercing" },
        { re: /club/i, category: "clubbing" },
        { re: /mechanical/i, category: "mechanical" },
        { re: /temporary/i, category: "temporary" }
    ];

    const MOD_CATALOG = Object.freeze({
        "Reflex Sight": { accuracyFlat: 1 },
        "Holographic Sight": { accuracyFlat: 1.25 },
        "Acog Sight": { accuracyFlat: 1.5 },
        "Thermal Sight": { accuracyFlat: 1.75 },
        "1mW Laser": { critRatePct: 2 },
        "5mW Laser": { critRatePct: 3 },
        "30mW Laser": { critRatePct: 4 },
        "100mW Laser": { critRatePct: 5 },
        "Small Suppressor": { damagePct: -5, note: "Also increases Stealth." },
        "Standard Suppressor": { damagePct: -5, note: "Also increases Stealth." },
        "Large Suppressor": { damagePct: -5, note: "Also increases Stealth." },
        "Adjustable Trigger": { firstTurnAccuracyFlat: 5 },
        "Hair Trigger": { firstTurnAccuracyFlat: 7.5 },
        "Bipod": { accuracyFlat: 1.75, note: "Also reduces Dexterity; battle-stat effects are separate." },
        "Tripod": { accuracyFlat: 2, note: "Also reduces Dexterity; battle-stat effects are separate." },
        "Custom Grip": { accuracyFlat: 0.75 },
        "Skeet Choke": { damagePct: 6 },
        "Improved Choke": { damagePct: 8 },
        "Full Choke": { damagePct: 10 },
        "Standard Brake": { accuracyFlat: 1, note: "Also reduces Stealth." },
        "Heavy Duty Brake": { accuracyFlat: 1.25, note: "Also reduces Stealth." },
        "Tactical Brake": { accuracyFlat: 1.5, note: "Also reduces Stealth." },
        "Small Light": { note: "Reduces opponent Accuracy and Stealth, not your own Accuracy." },
        "Precision Light": { note: "Reduces opponent Accuracy and Stealth, not your own Accuracy." },
        "Tactical Illuminator": { note: "Reduces opponent Accuracy and Stealth, not your own Accuracy." },
        "Extended Mags": { note: "Increases magazine size; no direct Damage or Accuracy bonus." },
        "High Capacity Mags": { note: "Increases magazine size; no direct Damage or Accuracy bonus." },
        "Extra Mags x2": { note: "Adds magazines; no direct Damage or Accuracy bonus." },
        "Extra Mag": { note: "Adds a magazine; no direct Damage or Accuracy bonus." },
        "Recoil Pad": { note: "Ammo conservation; no direct Damage or Accuracy bonus." }
    });

    // =========================================================================
    // STORAGE
    // =========================================================================

    const Storage = {
        /**
         * Reads and deserializes a stored value.
         * @param {string} key Unprefixed storage key.
         * @param {*} fallback Value returned when missing or invalid.
         * @returns {*} Stored value or fallback.
         */
        get(key, fallback) {
            const raw = GM_getValue(CONFIG.STORAGE_PREFIX + key, null);
            if (raw === null) return fallback;
            try {
                return JSON.parse(raw);
            } catch (error) {
                log("Invalid stored value", key, error);
                return fallback;
            }
        },

        /**
         * Serializes and stores a value.
         * @param {string} key Unprefixed storage key.
         * @param {*} value JSON-serializable value.
         * @returns {void}
         */
        set(key, value) {
            GM_setValue(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
        },

        /**
         * Removes a stored value.
         * @param {string} key Unprefixed storage key.
         * @returns {void}
         */
        remove(key) {
            GM_deleteValue(CONFIG.STORAGE_PREFIX + key);
        },
    };

    /**
     * Writes a debug message when debugging is enabled. Never pass the API key.
     * @param {...*} args Values to log.
     * @returns {void}
     */
    function log(...args) {
        if (CONFIG.DEBUG) console.debug("[Effective Weapon Stats]", ...args);
    }

    /**
     * Moves the key saved by v4.x into Tampermonkey storage and removes the old page storage.
     * @returns {void}
     */
    function migrateLegacyStorage() {
        try {
            const legacyKey = localStorage.getItem(CONFIG.LEGACY_API_KEY);
            if (legacyKey && !getApiKey()) setApiKey(legacyKey);
            CONFIG.LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        } catch (error) {
            log("Legacy storage migration skipped", error);
        }
    }

    /**
     * Reads the saved API key.
     * @returns {string} API key, or an empty string.
     */
    function getApiKey() {
        return Storage.get(CONFIG.STORAGE_KEYS.API_KEY, "");
    }

    /**
     * Saves or clears the API key.
     * @param {string} key API key; empty clears it.
     * @returns {void}
     */
    function setApiKey(key) {
        const cleaned = String(key || "").trim();
        if (cleaned) Storage.set(CONFIG.STORAGE_KEYS.API_KEY, cleaned);
        else Storage.remove(CONFIG.STORAGE_KEYS.API_KEY);
    }

    /**
     * Reads whether the breakdown is expanded.
     * @returns {boolean} True when expanded.
     */
    function isBreakdownOpen() {
        return Storage.get(CONFIG.STORAGE_KEYS.BREAKDOWN_OPEN, false) === true;
    }

    /**
     * Saves whether the breakdown is expanded.
     * @param {boolean} open True when expanded.
     * @returns {void}
     */
    function setBreakdownOpen(open) {
        Storage.set(CONFIG.STORAGE_KEYS.BREAKDOWN_OPEN, Boolean(open));
    }

    /**
     * Reads the saved ammo state for each slot.
     * @returns {Object<string, Object>} Ammo state keyed by slot.
     */
    function getPersistentAmmoCache() {
        return Storage.get(CONFIG.STORAGE_KEYS.AMMO, {}) || {};
    }

    /**
     * Saves the ammo state for each slot.
     * @param {Object<string, Object>} cache Ammo state keyed by slot.
     * @returns {void}
     */
    function setPersistentAmmoCache(cache) {
        Storage.set(CONFIG.STORAGE_KEYS.AMMO, cache);
    }

    // =========================================================================
    // CACHE
    // =========================================================================

    const Cache = {
        /**
         * Reads an entry regardless of age.
         * @param {string} key Unprefixed storage key.
         * @returns {{value: *, ts: number}|null} Entry, or null when missing.
         */
        peek(key) {
            const entry = Storage.get(key, null);
            return entry && Number.isFinite(entry.ts) && entry.value !== undefined ? entry : null;
        },

        /**
         * Reads a value only when it is younger than the TTL.
         * @param {string} key Unprefixed storage key.
         * @param {number} ttlMs Maximum age in milliseconds.
         * @returns {*|null} Cached value, or null when missing or expired.
         */
        get(key, ttlMs) {
            const entry = this.peek(key);
            return entry && Date.now() - entry.ts < ttlMs ? entry.value : null;
        },

        /**
         * Stores a value with the current time.
         * @param {string} key Unprefixed storage key.
         * @param {*} value JSON-serializable value.
         * @returns {void}
         */
        set(key, value) {
            Storage.set(key, { ts: Date.now(), value });
        },

        /**
         * Clears all API data and any retry cooldown, keeping the key.
         * @returns {void}
         */
        clearApiData() {
            const { API_BONUS, MERIT_NAMES, FAILURE } = CONFIG.STORAGE_KEYS;
            [API_BONUS, MERIT_NAMES, FAILURE].forEach((key) => Storage.remove(key));
        },
    };

    // =========================================================================
    // RUNTIME STATE
    // =========================================================================

    const NO_KEY_STATUS = "Enter API key to include education, merit, and job bonuses.";

    let bonusData = emptyBonusMap();
    let apiMeta = emptyApiMeta(NO_KEY_STATUS);
    let queued = false;
    let lastSig = "";
    let observerPaused = false;
    let updateDeferred = false;
    let refreshPromise = null;
    let settingsNotice = "";

    // =========================================================================
    // API
    // =========================================================================

    /** An API failure with Torn's error code when one was returned. */
    class ApiRequestError extends Error {
        /**
         * Creates an API error.
         * @param {string} message Readable message.
         * @param {number|null} [code=null] Torn API error code.
         */
        constructor(message, code = null) {
            super(message);
            this.name = "ApiRequestError";
            this.code = code;
        }
    }

    const RateLimiter = {
        /** @type {number[]} */
        calls: [],

        /**
         * Waits for a slot in the sliding window and claims it.
         * @returns {Promise<void>} Resolves when a request may be sent.
         */
        async acquire() {
            const { MAX_CALLS, WINDOW_MS } = CONFIG.RATE_LIMIT;
            for (;;) {
                const now = Date.now();
                this.calls = this.calls.filter((time) => now - time < WINDOW_MS);
                if (this.calls.length < MAX_CALLS) {
                    this.calls.push(now);
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, this.calls[0] + WINDOW_MS - now));
            }
        },
    };

    /**
     * Converts a Torn API error object to a readable error.
     * @param {{code: number, error: string}} apiError Error from the response.
     * @returns {ApiRequestError} Readable error.
     */
    function toApiError(apiError) {
        const code = Number(apiError?.code);
        const message = CONFIG.API_ERROR_MESSAGES[code]
            || `Torn API error ${Number.isFinite(code) ? code : "?"}: ${apiError?.error || "request rejected"}`;
        return new ApiRequestError(message, Number.isFinite(code) ? code : null);
    }

    const api = {
        /**
         * Sends one rate-limited GET request to Torn API v2.
         * @param {string} path Path beginning with "/".
         * @param {Object<string, string>} [params={}] Query parameters.
         * @param {string} [key=getApiKey()] API key, sent only in the header.
         * @returns {Promise<Object>} Parsed response.
         * @throws {ApiRequestError} On network, HTTP, parsing, or API errors.
         */
        async get(path, params = {}, key = getApiKey()) {
            await RateLimiter.acquire();
            const url = new URL(CONFIG.API_BASE + path);
            Object.entries({ ...params, comment: CONFIG.API_COMMENT })
                .forEach(([name, value]) => url.searchParams.set(name, value));

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url.href,
                    headers: { Authorization: `ApiKey ${key}`, Accept: "application/json" },
                    timeout: CONFIG.REQUEST_TIMEOUT_MS,
                    onload: (response) => {
                        let data;
                        try {
                            data = JSON.parse(response.responseText);
                        } catch {
                            reject(new ApiRequestError(`Torn API returned an unreadable response (HTTP ${response.status}).`));
                            return;
                        }
                        if (data?.error) reject(toApiError(data.error));
                        else if (response.status < 200 || response.status >= 300) reject(new ApiRequestError(`Torn API HTTP ${response.status}.`));
                        else resolve(data);
                    },
                    onerror: () => reject(new ApiRequestError("Could not reach the Torn API.")),
                    ontimeout: () => reject(new ApiRequestError("The Torn API request timed out.")),
                });
            });
        },
    };

    /**
     * Loads the merit id-to-name list, using the cache when possible.
     * @returns {Promise<Array<{id: number, name: string}>>} Merit catalog.
     * @throws {ApiRequestError} When no list can be loaded.
     */
    async function loadMeritCatalog() {
        const key = CONFIG.STORAGE_KEYS.MERIT_NAMES;
        const cached = Cache.get(key, CONFIG.TTL.MERIT_NAMES_MS);
        if (cached) return cached;

        try {
            const data = await api.get("/torn/merits");
            if (!Array.isArray(data?.merits)) throw new ApiRequestError("Unexpected merit list format.");
            Cache.set(key, data.merits);
            return data.merits;
        } catch (error) {
            const stale = Cache.peek(key);
            if (stale) return stale.value;
            throw error;
        }
    }

    /**
     * Fetches the user data and merit list, collecting errors instead of throwing.
     * @returns {Promise<{user: Object|null, catalog: Array|null, errors: string[], firstError: Error|null}>} Results.
     */
    async function fetchApiSources() {
        const errors = [];
        let firstError = null;
        let user = null;
        let catalog = null;

        /**
         * Records one failed source.
         * @param {string} label Source name.
         * @param {Error} error Failure.
         * @returns {void}
         */
        const record = (label, error) => {
            firstError = firstError || error;
            errors.push(`${label}: ${error.message || error}`);
        };

        try {
            user = await api.get("/user", { selections: CONFIG.USER_SELECTIONS });
        } catch (error) {
            record("user data", error);
        }

        if (user) {
            try {
                catalog = await loadMeritCatalog();
            } catch (error) {
                record("merit names", error);
            }
            errors.push(...validateUserResponse(user, catalog));
        }
        return { user, catalog, errors, firstError };
    }

    /**
     * Resets the API state for a missing or cleared key.
     * @param {string} status Status text.
     * @returns {void}
     */
    function resetApiState(status) {
        bonusData = emptyBonusMap();
        apiMeta = emptyApiMeta(status);
    }

    /**
     * Applies saved bonuses after a failure and labels them stale.
     * @param {{value: Object, ts: number}} cached Saved cache entry.
     * @param {string} reason Failure text.
     * @returns {void}
     */
    function useStaleBonuses(cached, reason) {
        bonusData = cached.value.bonusData;
        apiMeta = {
            ...cached.value.apiMeta,
            loaded: true,
            fromCache: true,
            stale: true,
            errors: [reason],
            status: `Using saved bonuses from ${new Date(cached.ts).toLocaleString()}. ${reason}`,
        };
    }

    /**
     * Starts the retry cooldown and prompts once for a rejected key.
     * @param {string} keyHash Hash of the key that failed.
     * @param {string} message Failure text.
     * @param {Error|null} firstError First failure, used for its error code.
     * @returns {void}
     */
    function recordApiFailure(keyHash, message, firstError) {
        Storage.set(CONFIG.STORAGE_KEYS.FAILURE, {
            keyHash, message, until: Date.now() + CONFIG.TTL.FAILURE_COOLDOWN_MS,
        });
        if (firstError?.code === 2 && Storage.get(CONFIG.STORAGE_KEYS.BAD_KEY_PROMPT, "") !== keyHash) {
            Storage.set(CONFIG.STORAGE_KEYS.BAD_KEY_PROMPT, keyHash);
            settingsNotice = firstError.message;
            openSettings();
        }
    }

    /**
     * Applies fresh or saved bonuses without a request when possible.
     * @param {string} keyHash Hash of the current key.
     * @param {{value: Object, ts: number}|null} cached Saved entry for this key.
     * @returns {boolean} True when no request is needed.
     */
    function applyWithoutRequest(keyHash, cached) {
        if (cached && Date.now() - cached.ts < CONFIG.TTL.API_BONUS_MS) {
            bonusData = cached.value.bonusData;
            apiMeta = {
                ...(cached.value.apiMeta || {}),
                loaded: true,
                fromCache: true,
                status: "API bonuses loaded from local cache.",
            };
            return true;
        }

        const failure = Storage.get(CONFIG.STORAGE_KEYS.FAILURE, null);
        if (failure?.keyHash !== keyHash || !(failure.until > Date.now())) return false;

        if (cached) {
            useStaleBonuses(cached, failure.message);
        } else {
            apiMeta = { ...emptyApiMeta(`API bonuses unavailable. ${failure.message}`), errors: [failure.message] };
        }
        return true;
    }

    /**
     * Loads API bonuses from the cache or Torn, preserving the last good data on failure.
     * @param {boolean} [force=false] True to skip the cache and cooldown.
     * @returns {Promise<void>} Resolves when state has been updated.
     */
    async function loadApiBonusData(force = false) {
        const key = getApiKey();
        if (!key) {
            resetApiState(NO_KEY_STATUS);
            return;
        }

        const keyHash = simpleKeyHash(key);
        const saved = Cache.peek(CONFIG.STORAGE_KEYS.API_BONUS);
        const cached = saved?.value?.keyHash === keyHash && saved.value.bonusData ? saved : null;

        if (!force && applyWithoutRequest(keyHash, cached)) return;

        apiMeta.status = "Loading API bonuses...";
        lastSig = "";
        update();

        const { user, catalog, errors, firstError } = await fetchApiSources();
        if (getApiKey() !== key) return;

        if (errors.length) {
            const message = errors.join("; ");
            recordApiFailure(keyHash, message, firstError);
            if (cached) {
                useStaleBonuses(cached, message);
                finishApiLoad();
                return;
            }
        }

        const built = buildBonusData(user, catalog);
        bonusData = built.map;
        apiMeta = {
            loaded: Boolean(user),
            fromCache: false,
            status: buildApiStatus(built, errors),
            lastUpdated: Date.now(),
            educationCount: built.educationCount,
            activePerkCount: built.activePerkCount,
            jobLabel: built.jobLabel,
            meritCount: built.meritCount,
            errors,
        };

        if (!errors.length) {
            Cache.set(CONFIG.STORAGE_KEYS.API_BONUS, { keyHash, bonusData, apiMeta });
            Storage.remove(CONFIG.STORAGE_KEYS.FAILURE);
            Storage.remove(CONFIG.STORAGE_KEYS.BAD_KEY_PROMPT);
        }
        finishApiLoad();
    }

    /**
     * Forces the next update to redraw after API state changes.
     * @returns {void}
     */
    function finishApiLoad() {
        lastSig = "";
        update();
    }

    // =========================================================================
    // DATA (no DOM access)
    // =========================================================================

    /**
     * Rounds to two decimals.
     * @param {number} n Value.
     * @returns {number} Rounded value.
     */
    function round2(n) {
        return Math.round((n + Number.EPSILON) * 100) / 100;
    }

    /**
     * Collapses whitespace and trims text.
     * @param {*} value Input.
     * @returns {string} Clean text.
     */
    function textClean(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    /**
     * Reduces a bonus name to lowercase letters and digits.
     * @param {string} name Bonus name.
     * @returns {string} Normalized key.
     */
    function normalizeWeaponBonusKey(name) {
        return String(name || "")
            .toLowerCase()
            .replace(/[–—]/g, "-")
            .replace(/[^a-z0-9]+/g, "");
    }

    /**
     * Resolves a bonus name or alias to its registry key.
     * @param {string} name Bonus name.
     * @returns {string} Registry key.
     */
    function getWeaponBonusKey(name) {
        const normalized = normalizeWeaponBonusKey(name);

        for (const [alias, key] of Object.entries(WEAPON_BONUS_PARSE_ALIASES)) {
            if (normalizeWeaponBonusKey(alias) === normalized) {
                return key;
            }
        }

        return normalized;
    }

    /**
     * Finds a bonus definition in the registry.
     * @param {string} nameOrKey Bonus name or key.
     * @returns {Object|null} Definition, or null when unknown.
     */
    function getWeaponBonusDefinition(nameOrKey) {
        return WEAPON_BONUS_REGISTRY[getWeaponBonusKey(nameOrKey)] || null;
    }

    /**
     * Fills in the summary text for a parsed bonus.
     * @param {Object} info Parsed bonus.
     * @returns {string} Summary.
     */
    function formatWeaponBonusSummary(info) {
        const definition = info?.definition || getWeaponBonusDefinition(info?.name);
        if (!definition) return `Unrecognized bonus: ${info?.raw || info?.label || "(unknown)"}`;

        const value = round2(info.value || 0);
        const half = round2(value / 2);

        return definition.summary
            .replaceAll("{value}", String(value))
            .replaceAll("{half}", String(half));
    }

    /**
     * Normalizes a weapon name for comparison.
     * @param {string} name Weapon name.
     * @returns {string} Normalized name.
     */
    function normalizeWeaponName(name) {
        return String(name || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .replace(/[’']/g, "'")
            .trim();
    }

    /**
     * Compares two weapon names, ignoring bonus badges.
     * @param {string} a First name.
     * @param {string} b Second name.
     * @returns {boolean} True when they match.
     */
    function weaponNamesMatch(a, b) {
        const left = normalizeWeaponName(a);
        const right = normalizeWeaponName(b);

        if (!left || !right) return false;
        if (left === right) return true;

        return normalizeWeaponName(cleanWeaponNameCandidate(a)) ===
            normalizeWeaponName(cleanWeaponNameCandidate(b));
    }

    /**
     * Checks whether a weapon receives Japanese blade bonuses.
     * @param {string} weaponName Weapon name.
     * @returns {boolean} True for Japanese blades.
     */
    function isJapaneseBladeWeapon(weaponName) {
        const normalized = normalizeWeaponName(weaponName);

        if (JAPANESE_BLADE_WEAPONS.has(normalized)) return true;

        return [...JAPANESE_BLADE_WEAPONS].some((bladeName) => {
            if (!normalized.startsWith(bladeName)) return false;

            const suffix = normalized.slice(bladeName.length);
            return /^\s*\d+(?:\.\d+)?\s*%\s*[a-z]/i.test(suffix);
        });
    }

    /**
     * Creates an empty bonus total.
     * @returns {Object} Bonus node.
     */
    function makeNode() {
        return {
            damagePct: 0,
            accuracyFlat: 0,
            critRatePct: 0,
            hitChancePct: 0,
            damageEntries: [],
            accuracyEntries: [],
            critRateEntries: [],
            hitChanceEntries: [],
            notes: []
        };
    }

    /**
     * Creates empty bonus totals for every scope.
     * @returns {Object<string, Object>} Bonus map.
     */
    function emptyBonusMap() {
        return {
            global: makeNode(),
            rifle: makeNode(),
            pistol: makeNode(),
            smg: makeNode(),
            shotgun: makeNode(),
            machinegun: makeNode(),
            heavyartillery: makeNode(),
            slashing: makeNode(),
            piercing: makeNode(),
            clubbing: makeNode(),
            mechanical: makeNode(),
            melee: makeNode(),
            temporary: makeNode(),
            primarysecondary: makeNode(),
            japaneseBlade: makeNode(),
            throat: makeNode()
        };
    }

    /**
     * Adds one bonus to a scope.
     * @param {Object} map Bonus map.
     * @param {string} category Scope.
     * @param {string} statType Stat name.
     * @param {number} value Amount.
     * @param {string} source Source label.
     * @param {string} [raw] Description.
     * @returns {void}
     */
    function addBonus(map, category, statType, value, source, raw) {
        if (!map[category]) return;
        if (!Number.isFinite(value) || value === 0) return;

        const entry = {
            value,
            source,
            raw: raw || `${value > 0 ? "+" : ""}${value}${statType === "accuracyFlat" ? " accuracy" : "%"}`
        };

        if (statType === "damagePct") {
            map[category].damagePct += value;
            map[category].damageEntries.push(entry);
        } else if (statType === "accuracyFlat") {
            map[category].accuracyFlat += value;
            map[category].accuracyEntries.push(entry);
        } else if (statType === "critRatePct") {
            map[category].critRatePct += value;
            map[category].critRateEntries.push(entry);
        } else if (statType === "hitChancePct") {
            map[category].hitChancePct += value;
            map[category].hitChanceEntries.push(entry);
        }
    }

    /**
     * Adds every stat in a table-defined bonus.
     * @param {Object} map Bonus map.
     * @param {Object} bonus Bonus definition.
     * @returns {void}
     */
    function applyStructuredBonus(map, bonus) {
        const categories = bonus.categories || ["global"];

        for (const category of categories) {
            if (bonus.damagePct) {
                addBonus(
                    map,
                    category,
                    "damagePct",
                    bonus.damagePct,
                    bonus.source,
                    `+${bonus.damagePct}% damage`
                );
            }

            if (bonus.accuracyFlat) {
                addBonus(
                    map,
                    category,
                    "accuracyFlat",
                    bonus.accuracyFlat,
                    bonus.source,
                    `+${bonus.accuracyFlat} accuracy`
                );
            }

            if (bonus.critRatePct) {
                addBonus(
                    map,
                    category,
                    "critRatePct",
                    bonus.critRatePct,
                    bonus.source,
                    `+${bonus.critRatePct}% critical hit rate`
                );
            }

            if (bonus.hitChancePct) {
                addBonus(map, category, "hitChancePct", bonus.hitChancePct,
                    bonus.source, `+${bonus.hitChancePct}% hit chance`);
            }
        }
    }

    /**
     * Combines the bonuses that apply to one weapon.
     * @param {string} category Weapon category.
     * @param {string} weaponName Weapon name.
     * @param {string} [slotType=""] Equipment slot.
     * @returns {Object} Combined totals and entries.
     */
    function getEffectiveBonusBundle(category, weaponName, slotType = "") {
        const base = {
            damagePct: 0,
            accuracyFlat: 0,
            critRatePct: 0,
            hitChancePct: 0,
            damageEntries: [],
            accuracyEntries: [],
            critRateEntries: [],
            hitChanceEntries: [],
            notes: []
        };

        if (!bonusData) return base;

        /**
         * Adds one scope's totals and entries.
         * @param {Object|undefined} node Bonus node.
         * @returns {void}
         */
        function merge(node) {
            if (!node) return;

            base.damagePct += node.damagePct || 0;
            base.accuracyFlat += node.accuracyFlat || 0;
            base.critRatePct += node.critRatePct || 0;
            base.hitChancePct += node.hitChancePct || 0;

            base.damageEntries.push(...(node.damageEntries || []));
            base.accuracyEntries.push(...(node.accuracyEntries || []));
            base.critRateEntries.push(...(node.critRateEntries || []));
            base.hitChanceEntries.push(...(node.hitChanceEntries || []));
            base.notes.push(...(node.notes || []));
        }

        const categories = new Set(["global", category]);

        if (MELEE_CATEGORIES.includes(category)) {
            categories.add("melee");
        }

        if (isJapaneseBladeWeapon(weaponName)) {
            categories.add("japaneseBlade");
        }

        if (["Primary", "Secondary"].includes(slotType) || RANGED_CATEGORIES.includes(category)) {
            categories.add("primarysecondary");
        }
        categories.add(`weapon:${normalizeWeaponName(weaponName)}`);
        for (const key of categories) merge(bonusData[key]);

        return base;
    }

    /**
     * Creates API status state with no data loaded.
     * @param {string} status Status text.
     * @returns {Object} API metadata.
     */
    function emptyApiMeta(status) {
        return {
            loaded: false,
            fromCache: false,
            status,
            lastUpdated: 0,
            educationCount: 0,
            jobLabel: "",
            meritCount: 0,
        };
    }

    /**
     * Joins owned merit levels to their names.
     * @param {Array<{id: number, level: number}>} upgrades Owned merit upgrades.
     * @param {Array<{id: number, name: string}>} catalog Merit list.
     * @returns {Object<string, number>} Merit levels keyed by name.
     */
    function toNamedMerits(upgrades, catalog) {
        const names = new Map((catalog || []).map((merit) => [Number(merit.id), merit.name]));
        const named = {};
        for (const upgrade of upgrades || []) {
            const name = names.get(Number(upgrade.id));
            if (name) named[name] = upgrade.level;
        }
        return named;
    }

    /**
     * Checks the v2 response shapes this script depends on.
     * @param {Object} user Response from /user.
     * @param {Array|null} catalog Merit list, or null when it failed to load.
     * @returns {string[]} Problems found.
     */
    function validateUserResponse(user, catalog) {
        const errors = [];
        if (!Array.isArray(user?.education?.complete)) errors.push("education: unexpected response format");
        if (!Array.isArray(user?.merits?.upgrades)) errors.push("merits: unexpected response format");
        if (!user?.perks || typeof user.perks !== "object") errors.push("perks: unexpected response format");
        if (catalog && !catalog.some((merit) => /mastery|critical\s+hit\s+rate/i.test(merit?.name || ""))) {
            errors.push("merits: named merit data unavailable");
        }
        return errors;
    }

    /**
     * Converts API data to the bonus map and counts.
     * @param {Object|null} user Response from /user.
     * @param {Array|null} catalog Merit list.
     * @returns {{map: Object, educationCount: number, activePerkCount: number, meritCount: number, jobLabel: string}} Built data.
     */
    function buildBonusData(user, catalog) {
        const map = emptyBonusMap();
        const educationCount = applyEducationBonuses(map, user);
        const activePerkCount = applyActivePerkBonuses(map, user);
        const meritCount = applyMeritBonuses(map, toNamedMerits(user?.merits?.upgrades, catalog));
        const jobLabel = applyJobBonuses(map, user);
        return { map, educationCount, activePerkCount, meritCount, jobLabel };
    }

    /**
     * Builds the status line for a completed API load.
     * @param {{educationCount: number, activePerkCount: number, meritCount: number, jobLabel: string}} built Built data.
     * @param {string[]} errors Problems found.
     * @returns {string} Status text.
     */
    function buildApiStatus(built, errors) {
        const parts = [];
        if (built.educationCount) parts.push(`${built.educationCount} education bonuses`);
        if (built.activePerkCount) parts.push(`${built.activePerkCount} active perk bonuses`);
        if (built.meritCount) parts.push(`${built.meritCount} merit bonuses`);
        if (built.jobLabel) parts.push(built.jobLabel);

        if (errors.length) {
            const base = parts.length ? `API bonuses loaded: ${parts.join(", ")}.` : "API bonuses incomplete.";
            return `${base} Missing data: ${errors.join("; ")}`;
        }
        return parts.length ? `API bonuses loaded: ${parts.join(", ")}.` : "API loaded, but no applicable bonuses found.";
    }

    /**
     * Creates a short non-secret fingerprint of a key for cache matching.
     * @param {string} key API key.
     * @returns {string} Hash.
     */
    function simpleKeyHash(key) {
        let h = 0;
        const s = String(key || "");

        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }

        return String(h);
    }

    /**
     * Adds bonuses from completed education courses.
     * @param {Object} map Bonus map.
     * @param {Object|null} data Response containing education.
     * @returns {number} Bonuses applied.
     */
    function applyEducationBonuses(map, data) {
        const complete = data?.education?.complete;

        if (!Array.isArray(complete)) return 0;

        const completed = new Set(complete.map(Number));
        let count = 0;

        for (const bonus of EDUCATION_BONUSES) {
            if (!completed.has(bonus.courseId)) continue;

            applyStructuredBonus(map, bonus);
            count++;
        }

        return count;
    }

    /**
     * Builds the company label; company perks arrive through the perks selection.
     * @param {Object} map Bonus map.
     * @param {Object|null} data Response containing job.
     * @returns {string} Company label, or empty.
     */
    function applyJobBonuses(map, data) {
        const job = data?.job;
        // Active job perks are authoritative: no guessed company-ID table
        // and no second copy of perks already read from the perks selection.
        if (!job || job.type !== "company") return "";
        return `${job.name || "Company"} (${Number(job.rating) || 0} stars)`;
    }

    /**
     * Reads one group of active perks.
     * @param {Object|null} data Response containing perks.
     * @param {string} key Perk group.
     * @returns {string[]} Perk descriptions.
     */
    function getActivePerkList(data, key) {
        const perks = data?.perks?.[key];
        return Array.isArray(perks) ? perks.map(textClean).filter(Boolean) : [];
    }

    /**
     * Checks whether a stat already has an entry from a source.
     * @param {Object} node Bonus node.
     * @param {string} entryList Entry list name.
     * @param {string} sourcePrefix Source prefix.
     * @returns {boolean} True when found.
     */
    function hasEntryFrom(node, entryList, sourcePrefix) {
        return (node?.[entryList] || []).some((entry) =>
            String(entry?.source || "").startsWith(sourcePrefix)
        );
    }

    /**
     * Adds a non-zero perk bonus.
     * @param {Object} map Bonus map.
     * @param {string} category Scope.
     * @param {string} statType Stat name.
     * @param {number} value Amount.
     * @param {string} source Source label.
     * @param {string} raw Description.
     * @returns {number} 1 when applied, otherwise 0.
     */
    function addActivePerkBonus(map, category, statType, value, source, raw) {
        if (!value) return 0;

        addBonus(map, category, statType, value, source, raw);
        return 1;
    }

    /**
     * Finds the weapon scopes a perk applies to.
     * @param {string} raw Perk description.
     * @returns {string[]} Scopes.
     */
    function getPerkScopes(raw) {
        if (/\bflamethrower\b/i.test(raw)) return ["weapon:flamethrower"];
        if (/\b(?:throat|neck)\b/i.test(raw)) return ["throat"];
        if (/\bjapanese\s+blades?\b/i.test(raw)) return ["japaneseBlade"];
        if (/\bprimary\b.*\bsecondary\b/i.test(raw)) return ["primarysecondary"];
        const scopes = CATEGORY_ALIASES.filter((item) => item.re.test(raw.toLowerCase()));
        if (!scopes.length) return ["global"];
        const categories = [...new Set(scopes.filter((item) => SUPPORTED_CATEGORIES.includes(item.cat)).map((item) => item.cat))];
        // A specific melee class already implies the general melee scope.
        return categories.length > 1 ? categories.filter((category) => category !== "melee") : categories;
    }

    /**
     * Extracts outgoing combat stats from perk text.
     * @param {string} raw Perk description.
     * @returns {Array<{statType: string, value: number, raw: string}>} Modifiers.
     */
    function parseCombatModifiers(raw) {
        const text = textClean(raw).replace(/[−–]/g, "-");
        const modifiers = [];
        // Stop at the next number/sign so a different stat's number cannot be
        // borrowed (e.g. +25% Strength and +10% Damage).
        const pattern = /([+-]?\s*\d+(?:\.\d+)?)\s*(%)?\s*([^\d%+;,\n]{0,65}?)\b(critical[- ]hit (?:rate|chance)|crit(?:ical)? (?:rate|chance)|hit (?:chance|rate|increase)|damage|accuracy)\b/gi;
        for (const match of text.matchAll(pattern)) {
            let value = Number(match[1].replace(/\s+/g, ""));
            const stat = match[4].toLowerCase();
            const context = match[3].toLowerCase();
            if (!Number.isFinite(value) || /\b(?:opponent|enemy|incoming|mitigat|strength|speed|dexterity|defense)\b/.test(context)) continue;
            if (/\b(?:decreased|reduced|less|reduction)\b/.test(context)) value = -Math.abs(value);
            const raw = match[0];
            if (stat === "damage" && match[2]) modifiers.push({ statType: "damagePct", value, raw });
            else if (stat === "accuracy" && !match[2]) modifiers.push({ statType: "accuracyFlat", value, raw });
            else if (/^(?:critical|crit)/.test(stat) && match[2]) modifiers.push({ statType: "critRatePct", value, raw });
            else if (/^hit /.test(stat) && match[2]) modifiers.push({ statType: "hitChancePct", value, raw });
        }
        return modifiers;
    }

    /**
     * Adds unconditional active perks and notes conditional ones.
     * @param {Object} map Bonus map.
     * @param {Object|null} data Response containing perks.
     * @returns {number} Bonuses applied.
     */
    function applyActivePerkBonuses(map, data) {
        let count = 0;
        const groups = [
            ["property", "Property perk"],
            ["faction", "Faction perk"],
            ["job", "Company perk"],
            ["education", "Education perk"],
            ["book", "Active book perk"],
            ["enhancer", "Active enhancer perk"]
        ];
        for (const [key, source] of groups) {
            for (const raw of new Set(getActivePerkList(data, key))) {
                if (!/\b(?:damage|accuracy|critical|hit chance|hit rate|hit increase)\b/i.test(raw)) continue;
                // These affect the opponent, mitigation, or damage over time,
                // rather than the outgoing direct-hit weapon stat.
                if (/\b(?:opponent|enemy|incoming|mitigation|hospital|burning|poison|bleed)\b/i.test(raw)) continue;
                const scopes = getPerkScopes(raw);
                if (!scopes.length) continue;
                const conditional = /\b(?:when|while|if|against|below|above|first turn|during)\b/i.test(raw) &&
                    !scopes.includes("throat");
                const modifiers = parseCombatModifiers(raw);
                if (conditional || !modifiers.length) {
                    for (const category of scopes) {
                        if (!map[category]) map[category] = makeNode();
                        const node = map[category];
                        node.notes.push({ source, raw: `${raw} (not included in the unconditional stat)` });
                    }
                    continue;
                }
                for (const { statType, value, raw: effectText } of modifiers) {
                    const explicitScopes = getPerkScopes(effectText);
                    const effectScopes = explicitScopes.length === 1 && explicitScopes[0] === "global" ? scopes : explicitScopes;
                    for (const category of effectScopes) {
                        if (!map[category]) map[category] = makeNode();
                        const node = map[category];
                        const list = { damagePct: "damageEntries", accuracyFlat: "accuracyEntries", critRatePct: "critRateEntries", hitChancePct: "hitChanceEntries" }[statType];
                        if (key === "education" && hasEntryFrom(node, list, "Education ")) continue;
                        count += addActivePerkBonus(map, category, statType, value, source, raw);
                    }
                }
            }
        }
        return count;
    }

    /**
     * Adds mastery and critical hit merits.
     * @param {Object} map Bonus map.
     * @param {Object<string, number>} namedMerits Merit levels keyed by name.
     * @returns {number} Merits applied.
     */
    function applyMeritBonuses(map, namedMerits) {
        let count = 0;

        for (const [rawName, rawLevel] of Object.entries(namedMerits)) {
            const name = String(rawName || "").trim();
            const level = Number(rawLevel);

            if (!name || !Number.isFinite(level) || level <= 0) continue;

            if (/critical\s+hit\s+rate/i.test(name)) {
                const crit = level * 0.5;

                addBonus(
                    map,
                    "global",
                    "critRatePct",
                    crit,
                    `Merit — ${name}`,
                    `Level ${level}: +${crit}% critical hit rate`
                );

                count++;
                continue;
            }

            if (!/mastery/i.test(name)) continue;

            const match = MERIT_CATEGORY_PATTERNS.find((item) => item.re.test(name));
            if (!match) continue;

            const damage = level;
            const accuracy = level * 0.2;

            addBonus(
                map,
                match.category,
                "damagePct",
                damage,
                `Merit — ${name}`,
                `Level ${level}: +${damage}% damage`
            );

            addBonus(
                map,
                match.category,
                "accuracyFlat",
                accuracy,
                `Merit — ${name}`,
                `Level ${level}: +${round2(accuracy)} accuracy`
            );

            count++;
        }

        return count;
    }

    /**
     * Creates a parsed bonus record.
     * @param {*} value Bonus value.
     * @param {string} parsedName Bonus name.
     * @param {string} raw Source text.
     * @param {string} [unit=""] Value unit.
     * @returns {Object} Parsed bonus.
     */
    function makeWeaponBonusInfo(value, parsedName, raw, unit = "") {
        const name = getWeaponBonusKey(parsedName);
        const definition = getWeaponBonusDefinition(name);

        return {
            value: Number.isFinite(Number(value)) ? Number(value) : 0,
            name,
            label: definition?.name || textClean(parsedName),
            raw: textClean(raw),
            unit: textClean(unit).toLowerCase(),
            known: Boolean(definition),
            definition
        };
    }

    /**
     * Parses all bonuses from bonus text.
     * @param {string} weaponBonusText Bonus text.
     * @returns {Object[]} Parsed bonuses.
     */
    function parseWeaponBonusInfos(weaponBonusText) {
        const text = textClean(weaponBonusText);
        if (!text || text === "(none)") return [];

        const found = [];
        const seen = new Set();
        const matchedRanges = [];

        /**
         * Records one parsed bonus and the text range it used.
         * @param {*} value Bonus value.
         * @param {string} parsedName Bonus name.
         * @param {string} raw Source text.
         * @param {string} [unit=""] Value unit.
         * @param {number} [start=-1] Match start.
         * @param {number} [end=-1] Match end.
         * @returns {void}
         */
        function add(value, parsedName, raw, unit = "", start = -1, end = -1) {
            if (
                start >= 0 &&
                matchedRanges.some((range) => start < range.end && end > range.start)
            ) {
                return;
            }

            const info = makeWeaponBonusInfo(value, parsedName, raw, unit);
            const signature = `${info.name}|${info.value}`;

            if (!info.name || seen.has(signature)) return;
            seen.add(signature);
            found.push(info);

            if (start >= 0) {
                matchedRanges.push({ start, end });
            }
        }

        const valueFirstPattern = new RegExp(
            `(\\d+(?:\\.\\d+)?)\\s*(%|t(?:urns?)?|turns?)?\\s*(${WEAPON_BONUS_NAME_PATTERN})`,
            "gi"
        );
        const candidates = [];

        for (const match of text.matchAll(valueFirstPattern)) {
            candidates.push({ value: parseFloat(match[1]), name: match[3], raw: match[0],
                unit: match[2] || "", start: match.index, end: match.index + match[0].length });
        }

        const nameFirstPattern = new RegExp(
            `(${WEAPON_BONUS_NAME_PATTERN})\\s*[:(\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(%|t(?:urns?)?|turns?)?`,
            "gi"
        );

        for (const match of text.matchAll(nameFirstPattern)) {
            candidates.push({ value: parseFloat(match[2]), name: match[1], raw: match[0],
                unit: match[3] || "", start: match.index, end: match.index + match[0].length });
        }

        // Consume labels in DOM order so a name-first label cannot steal the
        // preceding value from the next value-first / adjacent label.
        candidates.sort((a, b) => a.start - b.start || b.end - a.end);
        for (const candidate of candidates) {
            add(candidate.value, candidate.name, candidate.raw, candidate.unit, candidate.start, candidate.end);
        }

        if (!found.length) {
            const nameOnlyPattern = new RegExp(`^\\s*(${WEAPON_BONUS_NAME_PATTERN})\\s*$`, "i");
            const nameOnlyMatch = text.match(nameOnlyPattern);

            if (nameOnlyMatch) {
                add(0, nameOnlyMatch[1], nameOnlyMatch[0], "");
            }
        }

        if (!found.length) {
            const fallback = text.match(/^([0-9.]+)\s*%?\s*(.+)$/);

            if (fallback) {
                add(parseFloat(fallback[1]), fallback[2], fallback[0], "%");
            } else {
                add(0, text, text, "");
            }
        }

        return found;
    }

    /**
     * Removes bonus badges from a weapon name.
     * @param {string} value Candidate name.
     * @returns {string} Clean name.
     */
    function cleanWeaponNameCandidate(value) {
        const text = textClean(value);
        if (!text) return "";

        const badgePattern = new RegExp(
            `\\s*\\d+(?:\\.\\d+)?\\s*(?:%|t(?:urns?)?|turns?)?\\s*(?:${WEAPON_BONUS_NAME_PATTERN})`,
            "i"
        );
        const badgeMatch = badgePattern.exec(text);

        if (badgeMatch && badgeMatch.index > 0) {
            return text.slice(0, badgeMatch.index).trim();
        }

        const nameOnlyPattern = new RegExp(
            `\\s+(?:${WEAPON_BONUS_NAME_PATTERN})\\s*$`,
            "i"
        );

        return text.replace(nameOnlyPattern, "").trim();
    }

    /**
     * Detects a weapon category in text.
     * @param {string} txt Text to search.
     * @returns {{category: string, supported: boolean}} Category result.
     */
    function detectCategoryInfo(txt) {
        for (const alias of CATEGORY_ALIASES) {
            if (alias.re.test(txt)) {
                return {
                    category: alias.cat,
                    supported: SUPPORTED_CATEGORIES.includes(alias.cat)
                };
            }
        }

        return {
            category: "global",
            supported: true
        };
    }

    /**
     * Checks whether mod text changes critical hit damage rather than rate.
     * @param {string} txt Mod text.
     * @returns {boolean} True for critical hit damage.
     */
    function isCriticalHitDamageLine(txt) {
        return /\bcritical hit damage\b/.test(txt) || /\bcritical damage\b/.test(txt);
    }

    /**
     * Maps ammo text to a known ammo type.
     * @param {string} value Ammo text.
     * @returns {string} Ammo type, or empty.
     */
    function normalizeAmmoType(value) {
        const key = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
        if (/incendiary|^in$/.test(key)) return "Incendiary";
        if (/hollowpoint|^hp$/.test(key)) return "Hollow Point";
        if (/piercing|^pi$/.test(key)) return "Piercing";
        if (/tracer|^tr$/.test(key)) return "Tracer";
        if (/standard|normal|regular/.test(key)) return "Standard";
        return "";
    }

    /**
     * Converts parsed bonuses to unconditional modifiers.
     * @param {Object[]} weaponBonuses Parsed bonuses.
     * @returns {Object} Modifiers and summaries.
     */
    function getWeaponBonusModifiers(weaponBonuses) {
        const out = {
            damagePct: 0,
            critRatePct: 0,
            hitChancePct: 0,
            damageEntries: [],
            critEntries: [],
            hitChanceEntries: [],
            summaries: []
        };

        for (const info of weaponBonuses) {
            const definition = info.definition;
            const summary = formatWeaponBonusSummary(info);

            out.summaries.push({
                name: info.label || definition?.name || info.raw,
                group: definition?.group || "Unknown",
                summary,
                known: Boolean(definition)
            });

            if (!definition) continue;

            if (Number.isFinite(definition.unconditionalDamageFactor)) {
                const value = info.value * definition.unconditionalDamageFactor;
                out.damagePct += value;
                out.damageEntries.push({
                    source: `Weapon bonus — ${definition.name}`,
                    raw: `${value >= 0 ? "+" : ""}${round2(value)}% damage`
                });
            }

            if (Number.isFinite(definition.critRateFactor)) {
                const value = info.value * definition.critRateFactor;
                out.critRatePct += value;
                out.critEntries.push({
                    source: `Weapon bonus — ${definition.name}`,
                    raw: `+${round2(value)}% critical-hit rate`
                });
            }

            if (Number.isFinite(definition.hitChanceFactor)) {
                const value = info.value * definition.hitChanceFactor;
                out.hitChancePct += value;
                out.hitChanceEntries.push({
                    source: `Weapon bonus — ${definition.name}`,
                    raw: `${value >= 0 ? "+" : ""}${round2(value)}% hit chance`
                });
            }
        }

        return out;
    }

    /**
     * Builds conditional damage scenarios.
     * @param {Object[]} weaponBonuses Parsed bonuses.
     * @param {number} adjustedBaseDamage Base damage after flat mods.
     * @param {number} totalDamagePct Total additive damage bonus.
     * @returns {Object[]} Scenarios.
     */
    function buildWeaponBonusScenarios(weaponBonuses, adjustedBaseDamage, totalDamagePct) {
        const scenarios = [];
        const normalEffectiveDamage =
            adjustedBaseDamage *
            (1 + totalDamagePct / 100);
        const deadeyePct = weaponBonuses
            .filter((info) => info.name === "deadeye")
            .reduce((sum, info) => sum + info.value, 0);
        const throatEducationPct = bonusData?.throat?.damagePct || 0;
        const criticalLocations = new Set(["head", "throat", "heart"]);

        for (const info of weaponBonuses) {
            const definition = info.definition;
            const scenario = definition?.scenario;
            if (!scenario) continue;

            if (scenario.kind === "additive" || scenario.kind === "fixedAdditive") {
                let extraPct = scenario.kind === "fixedAdditive"
                    ? (scenario.extraPct || 0)
                    : info.value;
                const contributors = [{
                    source: `Weapon bonus — ${definition.name}`,
                    raw: scenario.kind === "fixedAdditive"
                        ? `+${scenario.extraPct || 0}% damage on proc`
                        : `+${info.value}% conditional damage`
                }];

                if (scenario.location && criticalLocations.has(scenario.location) && info.name !== "deadeye" && deadeyePct) {
                    extraPct += deadeyePct;
                    contributors.push({
                        source: "Weapon bonus — Deadeye",
                        raw: `+${deadeyePct}% critical-hit damage`
                    });
                }

                if (scenario.includeThroatEducation && throatEducationPct) {
                    extraPct += throatEducationPct;
                    contributors.push(...(bonusData?.throat?.damageEntries || []));
                }

                const scenarioTotalDamagePct = totalDamagePct + extraPct;
                const damage =
                    adjustedBaseDamage *
                    (1 + scenarioTotalDamagePct / 100);

                scenarios.push({
                    key: info.name,
                    label: scenario.label,
                    kind: scenario.kind,
                    damage: round2(damage),
                    extraPct: round2(extraPct),
                    totalDamagePct: round2(scenarioTotalDamagePct),
                    location: scenario.location || "",
                    locationMultiplier: scenario.locationMultiplier || null,
                    contributors
                });
                continue;
            }

            if (scenario.kind === "multiplier") {
                scenarios.push({
                    key: info.name,
                    label: scenario.label,
                    kind: scenario.kind,
                    damage: round2(normalEffectiveDamage * scenario.multiplier),
                    multiplier: scenario.multiplier,
                    contributors: [{
                        source: `Weapon bonus — ${definition.name}`,
                        raw: `${scenario.multiplier}× damage when the effect activates`
                    }]
                });
                continue;
            }

            if (scenario.kind === "multiHit") {
                scenarios.push({
                    key: info.name,
                    label: scenario.label,
                    kind: scenario.kind,
                    minDamage: round2(normalEffectiveDamage * scenario.minHits),
                    maxDamage: round2(normalEffectiveDamage * scenario.maxHits),
                    minHits: scenario.minHits,
                    maxHits: scenario.maxHits,
                    contributors: [{
                        source: `Weapon bonus — ${definition.name}`,
                        raw: `${scenario.minHits === scenario.maxHits
                            ? scenario.minHits
                            : `${scenario.minHits}–${scenario.maxHits}`} full-strength hit potential`
                    }]
                });
            }
        }

        if (throatEducationPct && !weaponBonuses.some((info) => info.name === "throttle")) {
            const extraPct = throatEducationPct + deadeyePct;
            scenarios.push({
                key: "throatEducation", label: "Throat-hit Effective Damage", kind: "additive",
                damage: round2(adjustedBaseDamage * (1 + (totalDamagePct + extraPct) / 100)),
                extraPct: round2(extraPct), totalDamagePct: round2(totalDamagePct + extraPct),
                location: "throat", locationMultiplier: 3.5,
                contributors: [
                    ...(bonusData?.throat?.damageEntries || []),
                    ...(deadeyePct ? [{ source: "Weapon bonus — Deadeye", raw: `+${deadeyePct}% critical-hit damage` }] : [])
                ]
            });
        }

        return scenarios;
    }

    /**
     * Calculates effective stats from parsed inputs.
     * @param {string} category Weapon category.
     * @param {Object} props Base stats.
     * @param {Object} modBonuses Mod totals.
     * @param {Object} ammoBonuses Ammo effects.
     * @param {string} weaponName Weapon name.
     * @param {string} weaponBonus Bonus text.
     * @param {string} weaponQuality Quality text.
     * @param {string} [slotType=""] Equipment slot.
     * @returns {Object|null} Results and breakdown details.
     */
    function calculate(category, props, modBonuses, ammoBonuses, weaponName, weaponBonus, weaponQuality, slotType = "") {
        if (!props) return null;

        const applied = getEffectiveBonusBundle(category, weaponName, slotType);

        const weaponXp = Math.max(0, Math.min(100, Number(props.xp) || 0));
        const xpDamagePct = weaponXp / 10;
        const xpAccuracyFlat = weaponXp * 0.02;

        const weaponBonuses = parseWeaponBonusInfos(weaponBonus);
        const weaponModifiers = getWeaponBonusModifiers(weaponBonuses);
        const adjustedBaseDamage = props.dmg + (modBonuses.damageFlat || 0);

        const totalDamagePct =
            applied.damagePct +
            xpDamagePct +
            weaponModifiers.damagePct +
            (modBonuses.damagePct || 0) +
            (ammoBonuses.damagePct || 0);

        const effectiveDamage =
            adjustedBaseDamage *
            (1 + totalDamagePct / 100);

        const bonusScenarios = buildWeaponBonusScenarios(
            weaponBonuses,
            adjustedBaseDamage,
            totalDamagePct
        );

        const effectiveAccuracy =
            props.acc +
            applied.accuracyFlat +
            xpAccuracyFlat +
            (modBonuses.accuracyFlat || 0) +
            (ammoBonuses.accuracyFlat || 0);

        const critRateBonus =
            applied.critRatePct +
            weaponModifiers.critRatePct +
            (modBonuses.critRatePct || 0);

        const estimatedCritChance = Math.max(0, Math.min(100, CONFIG.BASE_CRIT_RATE + critRateBonus));
        const firstTurnAccuracy = modBonuses.firstTurnAccuracyFlat
            ? round2(effectiveAccuracy + modBonuses.firstTurnAccuracyFlat) : null;
        const hitChancePct = (applied.hitChancePct || 0) + weaponModifiers.hitChancePct;
        const calculationNotes = [
            ...(applied.notes || []), ...(modBonuses.notes || [])
        ];
        if (ammoBonuses.stale) calculationNotes.push({ source: "Ammo not confirmed", raw: ammoBonuses.staleReason });
        if (!getApiKey()) calculationNotes.push({ source: "API bonuses missing", raw: "Add your API key to include your education, merits, faction, property and company perks." });
        else if (apiMeta.errors?.length) calculationNotes.push({ source: "API data incomplete", raw: apiMeta.errors.join("; ") });
        if (!SUPPORTED_CATEGORIES.includes(category) || category === "global") {
            calculationNotes.push({ source: "Weapon type not identified", raw: "Only confirmed global bonuses are included; class mastery and ammo may be missing." });
        }
        for (const info of weaponBonuses.filter((bonus) => !bonus.known)) {
            calculationNotes.push({ source: "Unknown weapon bonus", raw: `${info.raw} is shown for reference and is not assigned an assumed damage multiplier.` });
        }

        return {
            damage: round2(effectiveDamage),
            accuracy: round2(effectiveAccuracy),
            critRateBonus: round2(critRateBonus),
            estimatedCritChance: round2(estimatedCritChance),
            firstTurnAccuracy,
            hitChancePct: round2(hitChancePct),
            bonusScenarios,
            bonusSummaries: weaponModifiers.summaries,
            debug: {
                weaponName,
                weaponBonus,
                weaponQuality,
                category,
                baseDamage: props.dmg,
                baseAccuracy: props.acc,
                weaponXp,
                baseCritRate: CONFIG.BASE_CRIT_RATE,
                xpDamagePct: round2(xpDamagePct),
                xpAccuracyFlat: round2(xpAccuracyFlat),

                apiDamagePct: round2(applied.damagePct),
                apiAccuracyFlat: round2(applied.accuracyFlat),
                apiCritRatePct: round2(applied.critRatePct),
                apiDamageEntries: applied.damageEntries,
                apiAccuracyEntries: applied.accuracyEntries,
                apiCritEntries: applied.critRateEntries,
                apiHitChanceEntries: applied.hitChanceEntries,
                calculationNotes,

                weaponBonuses: weaponBonuses.map((info) => ({
                    name: info.label,
                    key: info.name,
                    value: info.value,
                    unit: info.unit,
                    known: info.known
                })),
                weaponBonusSummaries: weaponModifiers.summaries,
                weaponBonusDamagePct: round2(weaponModifiers.damagePct),
                weaponBonusDamageEntries: weaponModifiers.damageEntries,
                weaponBonusCritPct: round2(weaponModifiers.critRatePct),
                weaponCritEntries: weaponModifiers.critEntries,
                weaponBonusHitChancePct: round2(weaponModifiers.hitChancePct),
                weaponHitChanceEntries: weaponModifiers.hitChanceEntries,
                totalHitChancePct: round2(hitChancePct),
                bonusScenarios,

                modDamagePct: modBonuses.damagePct || 0,
                modDamageFlat: modBonuses.damageFlat || 0,
                modAccuracyPct: modBonuses.accuracyPct || 0,
                modAccuracyFlat: modBonuses.accuracyFlat || 0,
                firstTurnAccuracyFlat: modBonuses.firstTurnAccuracyFlat || 0,
                modCritRatePct: modBonuses.critRatePct || 0,
                modEntries: modBonuses.entries || [],
                modCritEntries: modBonuses.critEntries || [],

                ammoType: ammoBonuses.ammoType || "(none)",
                ammoDamagePct: ammoBonuses.damagePct || 0,
                ammoAccuracyFlat: ammoBonuses.accuracyFlat || 0,
                ammoEntries: ammoBonuses.stale
                    ? [{ source: "Ammo", raw: ammoBonuses.staleReason }]
                    : (ammoBonuses.entries || []),

                totalDamagePct: round2(totalDamagePct),
                totalCritRateBonus: round2(critRateBonus),
                estimatedCritChance: round2(estimatedCritChance)
            }
        };
    }

    // =========================================================================
    // UI
    // =========================================================================

    /**
     * Injects the script's scoped styles.
     * @returns {void}
     */
    function injectStyles() {
        GM_addStyle(`
            #${CONFIG.IDS.BOX} {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.10);
                font-size: 12px;
                line-height: 1.45;
                color: #ddd;
            }

            #${CONFIG.IDS.BOX} .tms-ews-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                margin: 3px 0;
            }

            #${CONFIG.IDS.BOX} .tms-ews-label {
                color: #bdbdbd;
                font-weight: 600;
            }

            #${CONFIG.IDS.BOX} .tms-ews-value {
                color: #f5f5f5;
                font-weight: 700;
            }

            #${CONFIG.IDS.BOX} .tms-ews-toggle {
                margin-top: 8px;
                width: 100%;
                text-align: left;
                background: rgba(255,255,255,0.08);
                color: #9ecbff;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 6px;
                padding: 6px 8px;
                font: 700 12px/1.2 Arial, sans-serif;
                cursor: pointer;
            }

            #${CONFIG.IDS.BOX} .tms-ews-toggle:hover {
                background: rgba(255,255,255,0.14);
            }

            #${CONFIG.IDS.BREAKDOWN} {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.12);
                display: none;
            }

            #${CONFIG.IDS.BREAKDOWN}[data-open="1"] {
                display: block;
            }

            .tms-ews-api {
                margin-bottom: 8px;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(255,255,255,0.10);
                display: flex;
                gap: 6px;
                align-items: center;
                flex-wrap: wrap;
            }

            .tms-ews-api-input {
                background: rgba(255,255,255,0.08);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 6px;
                padding: 4px 7px;
                font: 11px/1.2 monospace;
                min-width: 190px;
                max-width: 100%;
            }

            .tms-ews-btn {
                background: rgba(255,255,255,0.08);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 6px;
                padding: 4px 8px;
                font: 11px/1.2 monospace;
                cursor: pointer;
            }

            .tms-ews-btn:hover {
                background: rgba(255,255,255,0.15);
            }

            .tms-ews-btn[disabled] {
                opacity: 0.65;
                cursor: default;
            }

            .tms-ews-status {
                color: #9ecbff;
                font-size: 11px;
            }

            #${CONFIG.IDS.BOX} .tms-ews-section {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255,255,255,0.08);
            }

            #${CONFIG.IDS.BOX} .tms-ews-key {
                color: #9ecbff;
                font-weight: 700;
            }

            #${CONFIG.IDS.BOX} .tms-ews-val {
                color: #fff;
            }

            #${CONFIG.IDS.BOX} ul {
                margin: 4px 0 0 16px;
                padding: 0;
            }

            #${CONFIG.IDS.BOX} li {
                margin: 2px 0;
            }

            #${CONFIG.IDS.SETTINGS} {
                position: fixed;
                z-index: 100000;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0,0,0,0.55);
            }

            .tms-ews-panel {
                box-sizing: border-box;
                width: 460px;
                padding: 16px;
                border: 1px solid #555;
                border-radius: 6px;
                color: #eee;
                background: #2b2b2b;
                font-size: 13px;
            }

            .tms-ews-api-input {
                -webkit-text-security: disc;
            }

            .tms-ews-panel h2 {
                margin: 0 0 8px;
                font-size: 16px;
            }

            .tms-ews-panel .tms-ews-api {
                margin: 10px 0;
            }
        `);
    }

    /**
     * Finds the opened item panel.
     * @returns {HTMLElement|null} Panel.
     */
    function getDetailPanel() {
        return document.querySelector(CONFIG.SELECTORS.DETAIL_PANEL);
    }

    /**
     * Finds the list row of the opened weapon.
     * @returns {HTMLElement|null} Row.
     */
    function getOpenedWeaponRow() {
        const detailPanel = getDetailPanel();
        if (!detailPanel) return null;

        let previous = detailPanel.previousElementSibling;

        while (previous) {
            if (previous.matches && previous.matches(CONFIG.SELECTORS.WEAPON_ROW)) {
                return previous;
            }

            previous = previous.previousElementSibling;
        }

        return document.querySelector(CONFIG.SELECTORS.OPENED_ROW);
    }

    /**
     * Finds the opened item property list.
     * @returns {HTMLElement|null} List.
     */
    function getPropertiesList() {
        return document.querySelector(CONFIG.SELECTORS.PROPERTIES_LIST);
    }

    /**
     * Finds the element the stats box follows.
     * @returns {HTMLElement|null} Wrapper.
     */
    function getPreviewWrapper() {
        return document.querySelector(CONFIG.SELECTORS.PREVIEW_WRAPPER);
    }

    /**
     * Extracts plain text from Torn's tooltip markup without running it.
     * @param {string} html Tooltip HTML.
     * @returns {string} Plain text.
     */
    function decodeTooltipHtml(html) {
        return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").trim();
    }

    /**
     * Finds the opened weapon name.
     * @param {HTMLElement|null} openedRow Weapon row.
     * @param {HTMLElement|null} detailPanel Item panel.
     * @returns {string} Weapon name.
     */
    function getWeaponName(openedRow, detailPanel) {
        const rowName = cleanWeaponNameCandidate(
            openedRow?.querySelector(CONFIG.SELECTORS.ROW_ARIA_NAME)?.getAttribute("aria-label") ||
            openedRow?.querySelector(CONFIG.SELECTORS.ROW_NAME)?.textContent
        );
        if (rowName) return rowName;

        const description = detailPanel?.querySelector(CONFIG.SELECTORS.DESCRIPTION);
        const descName =
            description?.querySelector(".bold")?.textContent?.trim() ||
            description?.querySelector("b")?.textContent?.trim();

        if (descName) return cleanWeaponNameCandidate(descName);

        const imgAlt = detailPanel?.querySelector("img[alt]")?.getAttribute("alt")?.trim();
        if (imgAlt) return cleanWeaponNameCandidate(imgAlt);

        return "Weapon";
    }

    /**
     * Reads every value for a property label.
     * @param {HTMLElement|null} propertiesList Property list.
     * @param {string} label Property label.
     * @returns {string[]} Unique values.
     */
    function getPropertyValues(propertiesList, label) {
        if (!propertiesList) return [];

        const wanted = label.toLowerCase().replace(/:$/, "");
        const rows = propertiesList.querySelectorAll("li");
        const values = [];

        for (const row of rows) {
            const titleEl = row.querySelector(CONFIG.SELECTORS.PROPERTY_TITLE);

            const title = textClean(titleEl?.textContent).toLowerCase().replace(/:$/, "").trim();

            if (title && title !== wanted) continue;

            if (!title) {
                const rowText = textClean(row.textContent);
                const regex = new RegExp(`${label}:\\s*([^\\n]+)`, "i");
                const match = rowText.match(regex);
                if (match) values.push(textClean(match[1]));
                continue;
            }

            const valueWrapper = row.querySelector(CONFIG.SELECTORS.PROPERTY_VALUE_WRAPPER);
            const valueEl = label.toLowerCase() === "bonus"
                ? (
                    valueWrapper ||
                    row.querySelector(CONFIG.SELECTORS.LEGACY_PROPERTY_VALUE)
                )
                : (
                    row.querySelector(CONFIG.SELECTORS.PROPERTY_VALUE) ||
                    valueWrapper ||
                    row.querySelector(CONFIG.SELECTORS.LEGACY_PROPERTY_VALUE)
                );

            const value = textClean(valueEl?.textContent);
            if (value) values.push(value);
        }

        return [...new Set(values)];
    }

    /**
     * Reads the first value for a property label.
     * @param {HTMLElement|null} propertiesList Property list.
     * @param {string} label Property label.
     * @returns {string} Value, or empty.
     */
    function getPropertyValue(propertiesList, label) {
        return getPropertyValues(propertiesList, label)[0] || "";
    }

    /**
     * Reads all weapon bonus rows.
     * @param {HTMLElement|null} propertiesList Property list.
     * @returns {string} Joined bonus text.
     */
    function getWeaponBonus(propertiesList) {
        return getPropertyValues(propertiesList, "Bonus").join(" · ") || "(none)";
    }

    /**
     * Reads weapon quality.
     * @param {HTMLElement|null} propertiesList Property list.
     * @returns {string} Quality text.
     */
    function getWeaponQuality(propertiesList) {
        return getPropertyValue(propertiesList, "Quality") || "(none)";
    }

    /**
     * Finds the opened weapon category.
     * @param {HTMLElement|null} detailPanel Item panel.
     * @param {HTMLElement|null} openedRow Weapon row.
     * @returns {string} Category.
     */
    function parseCategoryFromDescription(detailPanel, openedRow) {
        const raw = (openedRow?.getAttribute("data-category") || "").trim().toLowerCase();

        if (raw === "temporary") {
            return "temporary";
        }

        const description = detailPanel?.querySelector(CONFIG.SELECTORS.DESCRIPTION);
        const text = (description?.innerText || description?.textContent || detailPanel?.innerText || "").toLowerCase();
        const typeLabel = text.match(/\bis an?\s+([a-z -]+?)\s+weapon\b/);
        if (typeLabel) return detectCategoryInfo(typeLabel[1]).category;

        const inferred = detectCategoryInfo(text);
        return inferred.supported ? inferred.category : "global";
    }

    /**
     * Reads the equipment slot from the row.
     * @param {HTMLElement|null} openedRow Weapon row.
     * @returns {string} Slot name, or empty.
     */
    function getOpenedWeaponSlot(openedRow) {
        const raw = (openedRow?.getAttribute("data-category") || "").trim().toLowerCase();

        if (raw === "primary") return "Primary";
        if (raw === "secondary") return "Secondary";
        if (raw === "melee") return "Melee";
        if (raw === "temporary") return "Temporary";

        return "";
    }

    /**
     * Reads damage, accuracy, and experience.
     * @param {HTMLElement|null} propertiesList Property list.
     * @returns {{dmg: number, acc: number, xp: number}|null} Stats, or null when unavailable.
     */
    function parseProps(propertiesList) {
        const dmg = parseFloat(getPropertyValue(propertiesList, "Damage"));
        const acc = parseFloat(getPropertyValue(propertiesList, "Accuracy"));
        const xpValue = parseFloat(getPropertyValue(propertiesList, "Experience"));
        const xp = Number.isFinite(xpValue) ? Math.max(0, Math.min(100, xpValue)) : 0;

        if (Number.isNaN(dmg) || Number.isNaN(acc)) return null;

        return { dmg, acc, xp };
    }

    /**
     * Reads the weapon mods shown on the row.
     * @param {HTMLElement|null} openedRow Weapon row.
     * @param {string} [weaponName=""] Weapon name.
     * @returns {Object} Mod totals and entries.
     */
    function parseDirectModsForOpenedWeapon(openedRow, weaponName = "") {
        const uid = openedRow?.getAttribute("data-armoryid");

        const out = {
            damagePct: 0,
            damageFlat: 0,
            accuracyPct: 0,
            accuracyFlat: 0,
            firstTurnAccuracyFlat: 0,
            critRatePct: 0,
            entries: [],
            critEntries: [],
            notes: []
        };

        if (!uid) return out;

        const modContainer =
            openedRow.querySelector(`[data-attachments-itemid="${CSS.escape(uid)}"]`) ||
            openedRow.querySelector(CONFIG.SELECTORS.MOD_CONTAINER_FALLBACK);

        if (!modContainer) return out;

        const icons = modContainer.querySelectorAll("i[title], [title]");
        const seen = new Set();
        const dual = /^dual\b/i.test(cleanWeaponNameCandidate(weaponName || openedRow.querySelector(CONFIG.SELECTORS.ROW_NAME)?.textContent));
        const scale = dual ? 0.5 : 1;
        const catalogNames = Object.keys(MOD_CATALOG).sort((a, b) => b.length - a.length);

        for (const icon of icons) {
            const rawText = decodeTooltipHtml(icon.getAttribute("title") || "");
            const txt = rawText.toLowerCase();
            if (!txt) continue;
            const normalized = normalizeWeaponBonusKey(rawText);
            const name = catalogNames.find((candidate) => normalized.includes(normalizeWeaponBonusKey(candidate)));
            const signature = name || txt;
            if (seen.has(signature)) continue;
            seen.add(signature);

            const definition = name ? MOD_CATALOG[name] : null;
            const entry = { source: "Weapon mods", raw: `${rawText}${dual ? " [dual weapon: half effect]" : ""}` };
            let used = false;
            if (definition) {
                for (const key of ["damagePct", "accuracyFlat", "critRatePct", "firstTurnAccuracyFlat"]) {
                    if (!definition[key]) continue;
                    out[key] += definition[key] * scale;
                    used = true;
                    if (key === "critRatePct") out.critEntries.push(entry);
                }
                if (definition.note) out.notes.push({ source: name, raw: definition.note });
            } else {
                // New/unnamed attachments can still supply explicit values.
                // Opponent effects and conditional accuracy stay separate.
                const modifiers = /\b(?:opponent|enemy)\b/i.test(txt) ? [] : parseCombatModifiers(rawText);
                for (const { statType, value } of modifiers) {
                    if (statType === "damagePct" && isCriticalHitDamageLine(txt)) continue;
                    if (statType === "hitChancePct") continue;
                    const key = statType === "accuracyFlat" && /\bfirst turn\b/.test(txt)
                        ? "firstTurnAccuracyFlat" : statType;
                    out[key] += value * scale;
                    if (key === "critRatePct") out.critEntries.push(entry);
                    used = true;
                }
                if (!used) out.notes.push({ source: "Weapon mod", raw: `${rawText} (no unconditional stat adjustment identified)` });
            }
            if (used) out.entries.push(entry);
        }

        return out;
    }

    /**
     * Reads the loadout slot on screen.
     * @returns {Object|null} Slot state, or null when unavailable.
     */
    function getCurrentSelectedLoadoutState() {
        const root = document.querySelector(CONFIG.SELECTORS.LOADOUT_CURRENT);

        if (!root) return null;

        const review = root.querySelector(CONFIG.SELECTORS.LOADOUT_REVIEW) || root;

        const img = review.querySelector(CONFIG.SELECTORS.LOADOUT_IMAGE);

        const ammoBox = review.querySelector(CONFIG.SELECTORS.LOADOUT_AMMO);

        const ammoText = review.querySelector(CONFIG.SELECTORS.LOADOUT_AMMO_TEXT);

        const typeEl = review.querySelector(CONFIG.SELECTORS.LOADOUT_TYPE);

        const weaponName = (img?.getAttribute("alt") || "").trim();
        const rawSlotType = textClean(typeEl?.textContent);
        const slotType = ["Primary", "Secondary", "Melee", "Temporary"].find((slot) =>
            new RegExp(`\\b${slot}\\b`, "i").test(rawSlotType)
        ) || rawSlotType;
        const aria = (ammoBox?.getAttribute("aria-label") || "").trim();
        const ammoCountText = textClean(ammoText?.textContent);

        let ammoType = "";

        const match = aria.match(/Ammo type is\s+["']?([^"']+)/i);
        if (match) ammoType = normalizeAmmoType(match[1]);

        if (!ammoType && ammoText) {
            const className = String(ammoText.className || "");
            ammoType = normalizeAmmoType(className) || normalizeAmmoType(ammoCountText);
        }

        if (!slotType || !weaponName) return null;

        return {
            slotType,
            weaponName,
            ammoType: ammoType || "(none)",
            ammoCountText,
            aria
        };
    }

    /**
     * Saves the visible ammo when it changes or needs reconfirming.
     * @returns {void}
     */
    function refreshAmmoCacheFromLoadout() {
        const state = getCurrentSelectedLoadoutState();
        if (!state) return;
        if (!normalizeAmmoType(state.ammoType)) return;

        const cache = getPersistentAmmoCache();
        const previous = cache[state.slotType];

        if (
            previous &&
            previous.weaponName === state.weaponName &&
            previous.ammoType === state.ammoType &&
            previous.ammoCountText === state.ammoCountText &&
            previous.aria === state.aria &&
            Date.now() - previous.ts < CONFIG.TTL.AMMO_RECONFIRM_MS
        ) {
            return;
        }

        cache[state.slotType] = {
            weaponName: state.weaponName,
            weaponNameNorm: normalizeWeaponName(state.weaponName),
            ammoType: state.ammoType,
            ammoCountText: state.ammoCountText,
            aria: state.aria,
            ts: Date.now()
        };

        setPersistentAmmoCache(cache);
    }

    /**
     * Finds confirmed ammo effects for a weapon.
     * @param {string} slotType Equipment slot.
     * @param {string} weaponName Weapon name.
     * @param {string} category Weapon category.
     * @returns {Object} Ammo effects and status.
     */
    function getAmmoBonusesForWeapon(slotType, weaponName, category) {
        const out = {
            ammoType: "(none)",
            damagePct: 0,
            accuracyFlat: 0,
            entries: [],
            stale: false,
            staleReason: ""
        };

        if (!RANGED_CATEGORIES.includes(category)) {
            return out;
        }

        const cache = getPersistentAmmoCache();
        const slotState = cache[slotType];

        if (!slotState) {
            out.ammoType = "(unknown)";
            out.stale = true;
            out.staleReason = "No visible ammo cache for this slot yet.";
            return out;
        }

        if (!weaponNamesMatch(slotState.weaponName, weaponName)) {
            out.ammoType = "(unknown)";
            out.stale = true;
            out.staleReason = `Cached ${slotType} ammo belongs to "${slotState.weaponName}", not "${weaponName}".`;
            return out;
        }

        if (!Number.isFinite(slotState.ts) || Date.now() - slotState.ts > CONFIG.TTL.AMMO_MS || slotState.ts > Date.now() + 60000) {
            out.ammoType = "(unknown)";
            out.stale = true;
            out.staleReason = "Ammo cache expired. Open this weapon's equipped loadout slot to confirm current ammo.";
            return out;
        }

        out.ammoType = normalizeAmmoType(slotState.ammoType) || "(unknown)";
        if (out.ammoType === "(unknown)") {
            out.stale = true;
            out.staleReason = "Ammo type is not recognized. Confirm it in the equipped loadout slot.";
            return out;
        }

        const ammoKey = out.ammoType.toLowerCase().replace(/[^a-z]/g, "");

        if (AMMO_DAMAGE_PCT[ammoKey]) {
            out.damagePct += AMMO_DAMAGE_PCT[ammoKey];
            out.entries.push({
                source: "Ammo",
                raw: `${slotState.ammoType}: +${AMMO_DAMAGE_PCT[ammoKey]}% damage`
            });
        }

        if (AMMO_ACCURACY_FLAT[ammoKey]) {
            out.accuracyFlat += AMMO_ACCURACY_FLAT[ammoKey];
            out.entries.push({
                source: "Ammo",
                raw: `${slotState.ammoType}: +${AMMO_ACCURACY_FLAT[ammoKey]} accuracy`
            });
        }

        if (ammoKey === "hollowpoint" || ammoKey === "piercing") {
            out.entries.push({
                source: "Ammo armor effect",
                raw: ammoKey === "hollowpoint"
                    ? "Hollow Point also increases enemy armor value by 50%. This target-dependent penalty is separate from the effective Damage stat."
                    : "Piercing halves enemy armor value. This target-dependent benefit is separate from the effective Damage stat."
            });
        }

        return out;
    }

    /**
     * Formats a value with its sign.
     * @param {number} value Value.
     * @param {string} [suffix=""] Text after the number.
     * @returns {string} Formatted value.
     */
    function formatSignedValue(value, suffix = "") {
        const rounded = round2(Number(value) || 0);
        return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
    }

    /**
     * Formats a scenario damage value or range.
     * @param {Object} scenario Scenario.
     * @returns {string} Formatted damage.
     */
    function formatBonusScenarioValue(scenario) {
        if (scenario.kind === "multiHit") {
            if (scenario.minDamage === scenario.maxDamage) {
                return scenario.minDamage.toFixed(2);
            }

            return `${scenario.minDamage.toFixed(2)}–${scenario.maxDamage.toFixed(2)}`;
        }

        return Number(scenario.damage).toFixed(2);
    }

    /**
     * Creates an element without parsing HTML.
     * @param {string} tag Element tag name.
     * @param {{id?: string, className?: string, text?: string, attrs?: Object<string, string>, onClick?: EventListener}} [options={}] Element options.
     * @param {Array<Node|string|null|false>} [children=[]] Children; empty values are skipped.
     * @returns {HTMLElement} Created element.
     */
    function createEl(tag, options = {}, children = []) {
        const element = document.createElement(tag);
        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = options.text;
        Object.entries(options.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value));
        if (options.onClick) element.addEventListener("click", options.onClick);
        element.append(...children.filter((child) => child !== null && child !== false && child !== undefined));
        return element;
    }

    /**
     * Creates a summary row.
     * @param {string} label Row label.
     * @param {string|number} value Row value.
     * @returns {HTMLElement} Row.
     */
    function statRow(label, value) {
        return createEl("div", { className: "tms-ews-row" }, [
            createEl("span", { className: "tms-ews-label", text: label }),
            createEl("span", { className: "tms-ews-value", text: String(value) }),
        ]);
    }

    /**
     * Creates a "key: value" line.
     * @param {string} key Label without the colon.
     * @param {string|number} value Value.
     * @returns {HTMLElement} Line.
     */
    function keyValue(key, value) {
        return createEl("div", {}, [
            createEl("span", { className: "tms-ews-key", text: `${key}:` }),
            " ",
            createEl("span", { className: "tms-ews-val", text: String(value) }),
        ]);
    }

    /**
     * Creates a breakdown section.
     * @param {Array<Node|null|false>} children Section content.
     * @returns {HTMLElement} Section.
     */
    function section(children) {
        return createEl("div", { className: "tms-ews-section" }, children);
    }

    /**
     * Creates a plain text line.
     * @param {string} text Line text.
     * @returns {HTMLElement} Line.
     */
    function textLine(text) {
        return createEl("div", { text });
    }

    /**
     * Renders source and description entries.
     * @param {Array<{source: string, raw: string}>} entries Entries.
     * @returns {HTMLElement} List, or "(none)".
     */
    function renderEntryList(entries) {
        if (!entries || !entries.length) return textLine("(none)");
        return createEl("ul", {}, entries.map((entry) => createEl("li", {}, [
            createEl("b", { text: entry.source }),
            `: ${entry.raw}`,
        ])));
    }

    /**
     * Renders a section only when it has a non-zero value or entries.
     * @param {string} title Section title.
     * @param {string} valueText Displayed value.
     * @param {Array<{source: string, raw: string}>} entries Contributing entries.
     * @returns {HTMLElement|null} Section, or null when empty.
     */
    function renderConditionalBlock(title, valueText, entries) {
        const compact = String(valueText).replace(/\s+/g, "");
        const hasValue = !/^\+?0(?:\.0+)?%?$/.test(compact);
        const hasEntries = entries && entries.length;
        if (!hasValue && !hasEntries) return null;
        return section([keyValue(title, valueText), renderEntryList(entries)]);
    }

    /**
     * Renders one conditional weapon bonus scenario.
     * @param {Object} scenario Scenario from buildWeaponBonusScenarios.
     * @returns {HTMLElement} Section.
     */
    function renderBonusScenario(scenario) {
        return section([
            keyValue(scenario.label, formatBonusScenarioValue(scenario)),
            Number.isFinite(scenario.extraPct) && keyValue("Conditional Damage Added", `+${scenario.extraPct}%`),
            Number.isFinite(scenario.extraPct) && keyValue("Scenario Total Damage Bonus", `+${scenario.totalDamagePct}%`),
            scenario.locationMultiplier && keyValue(
                "Combat Location Multiplier",
                `${scenario.locationMultiplier}× (separate; not included in the effective stat above)`,
            ),
            renderEntryList(scenario.contributors || []),
        ]);
    }

    /**
     * Renders the weapon bonus analysis.
     * @param {Object} debug Calculation details.
     * @returns {HTMLElement|null} Section, or null without a known bonus.
     */
    function renderWeaponBonusAnalysis(debug) {
        const summaries = debug.weaponBonusSummaries || [];
        if (!summaries.length) return null;

        return section([
            createEl("div", {}, [createEl("span", { className: "tms-ews-key", text: "Weapon Bonus Analysis:" })]),
            renderEntryList(summaries.map((summary) => ({
                source: `${summary.name} — ${summary.group}`,
                raw: summary.summary,
            }))),
            ...(debug.bonusScenarios || []).map(renderBonusScenario),
        ]);
    }

    /**
     * Renders weapon identity and base stat lines.
     * @param {Object} d Calculation details.
     * @returns {HTMLElement[]} Lines.
     */
    function renderWeaponDetails(d) {
        return [
            keyValue("Weapon", d.weaponName),
            keyValue("Weapon Bonus", d.weaponBonus),
            keyValue("Quality", d.weaponQuality),
            keyValue("Category", d.category),
            keyValue("Ammo Type", d.ammoType),
            keyValue("Base Damage", d.baseDamage),
            keyValue("Base Accuracy", d.baseAccuracy),
            textLine("Quality describes the base weapon stats; it is not an additional damage bonus."),
            keyValue("Weapon XP", `${d.weaponXp}%`),
            keyValue("Base Crit Rate", `${d.baseCritRate}%`),
        ];
    }

    /**
     * Renders the mod totals section.
     * @param {Object} d Calculation details.
     * @returns {HTMLElement|null} Section, or null without mods.
     */
    function renderModSection(d) {
        if (!(d.modDamagePct || d.modDamageFlat || d.modAccuracyFlat || d.firstTurnAccuracyFlat || d.modEntries.length)) return null;
        return section([
            keyValue("Mod Damage Bonus", `${formatSignedValue(d.modDamagePct, "%")} | flat ${formatSignedValue(d.modDamageFlat)}`),
            keyValue("Mod Accuracy Bonus", formatSignedValue(d.modAccuracyFlat)),
            d.firstTurnAccuracyFlat && keyValue("First-turn Mod Accuracy", formatSignedValue(d.firstTurnAccuracyFlat)),
            renderEntryList(d.modEntries),
        ]);
    }

    /**
     * Renders the bonus source sections.
     * @param {Object} d Calculation details.
     * @returns {Array<HTMLElement|null>} Sections.
     */
    function renderBonusSections(d) {
        return [
            renderConditionalBlock("Damage Bonus", formatSignedValue(d.apiDamagePct, "%"), d.apiDamageEntries),
            renderConditionalBlock("Accuracy Bonus", formatSignedValue(d.apiAccuracyFlat), d.apiAccuracyEntries),
            renderConditionalBlock("Crit Rate Bonus", `+${d.apiCritRatePct}%`, d.apiCritEntries),
            renderConditionalBlock("Weapon Damage Modifier", formatSignedValue(d.weaponBonusDamagePct, "%"), d.weaponBonusDamageEntries),
            renderConditionalBlock("Weapon Bonus Crit Rate", formatSignedValue(d.weaponBonusCritPct, "%"), d.weaponCritEntries),
            renderConditionalBlock(
                "Additional Hit Chance Modifier",
                formatSignedValue(d.totalHitChancePct, "%"),
                [...(d.apiHitChanceEntries || []), ...d.weaponHitChanceEntries],
            ),
            renderWeaponBonusAnalysis(d),
            RANGED_CATEGORIES.includes(d.category) && section([
                keyValue("Ammo Damage Bonus", formatSignedValue(d.ammoDamagePct, "%")),
                keyValue("Ammo Accuracy Bonus", `+${d.ammoAccuracyFlat}`),
                renderEntryList(d.ammoEntries),
            ]),
            renderModSection(d),
            renderConditionalBlock("Mod Crit Rate Bonus", `+${d.modCritRatePct}%`, d.modCritEntries),
        ];
    }

    /**
     * Renders the expandable breakdown.
     * @param {Object} result Result from calculate.
     * @returns {Array<Node|null|false>} Breakdown content.
     */
    function renderBreakdown(result) {
        const d = result.debug;
        const apiTime = apiMeta.lastUpdated ? new Date(apiMeta.lastUpdated).toLocaleString() : "never";

        return [
            createEl("button", { className: "tms-ews-btn", text: "API settings", attrs: { type: "button" }, onClick: openSettings }),
            ...renderWeaponDetails(d),
            section([keyValue("API Status", apiMeta.status || ""), keyValue("Last API Update", apiTime)]),
            section([keyValue("XP Damage Bonus", `+${d.xpDamagePct}%`), keyValue("XP Accuracy Bonus", `+${d.xpAccuracyFlat}`)]),
            ...renderBonusSections(d),
            section([
                keyValue("Total Damage Bonus", formatSignedValue(d.totalDamagePct, "%")),
                keyValue("Total Crit Rate Bonus", `+${d.totalCritRateBonus}%`),
                keyValue("Estimated Total Crit Chance", `${d.estimatedCritChance}%`),
            ]),
            section([keyValue("Final Effective Damage", result.damage), keyValue("Final Effective Accuracy", result.accuracy)]),
            section([
                textLine("Effective Damage = (base Damage + flat mod Damage) × (1 + total additive Damage bonus / 100)."),
                textLine("Effective weapon stats are not predicted HP damage or an opponent-specific hit chance. Combat stats, hit location and target armor apply separately."),
                textLine("Conditional rows show the named effect; separate conditional rows are not automatically combined."),
                renderEntryList(d.calculationNotes),
            ]),
        ];
    }

    /**
     * Summarizes where the bonuses came from.
     * @returns {string} Short status.
     */
    function getApiStatusLabel() {
        if (!getApiKey()) return "API: no key";
        if (apiMeta.stale) return "API: saved data";
        if (apiMeta.errors?.length) return "API: incomplete";
        if (apiMeta.fromCache) return "API: cached";
        return apiMeta.loaded ? "API: loaded" : "API: loading";
    }

    /**
     * Creates the breakdown toggle and its panel.
     * @param {Object} result Result from calculate.
     * @returns {HTMLElement[]} Toggle and panel.
     */
    function buildBreakdownControls(result) {
        const open = isBreakdownOpen();
        const labelFor = (isOpen) => (isOpen ? "Hide breakdown" : "Show breakdown");
        const panel = createEl("div", { id: CONFIG.IDS.BREAKDOWN, attrs: { "data-open": open ? "1" : "0" } }, renderBreakdown(result));
        const toggle = createEl("button", {
            className: "tms-ews-toggle",
            text: labelFor(open),
            attrs: { type: "button" },
            onClick: () => {
                const next = panel.getAttribute("data-open") !== "1";
                panel.setAttribute("data-open", next ? "1" : "0");
                setBreakdownOpen(next);
                toggle.textContent = labelFor(next);
            },
        });
        return [toggle, panel];
    }

    /**
     * Draws the stats box.
     * @param {HTMLElement} detailPanel Opened item panel.
     * @param {HTMLElement} previewWrapper Element the box follows.
     * @param {Object} result Result from calculate.
     * @returns {void}
     */
    function renderBox(detailPanel, previewWrapper, result) {
        if (!detailPanel || !previewWrapper || !result) return;

        withObserverPause(() => {
            const box = ensureBox(detailPanel, previewWrapper);
            box.replaceChildren(...[
                statRow("Effective Damage", result.damage.toFixed(2)),
                ...(result.bonusScenarios || []).map((scenario) => statRow(scenario.label, formatBonusScenarioValue(scenario))),
                statRow("Effective Accuracy", result.accuracy.toFixed(2)),
                result.firstTurnAccuracy !== null && statRow("First-turn Effective Accuracy", result.firstTurnAccuracy.toFixed(2)),
                Boolean(result.hitChancePct) && statRow("Additional Hit Chance Modifier", formatSignedValue(result.hitChancePct, "%")),
                result.critRateBonus > 0 && statRow("Crit Rate Bonus", `+${result.critRateBonus.toFixed(2)}%`),
                statRow("Est. Total Crit Chance", `${result.estimatedCritChance.toFixed(2)}%`),
                statRow("Weapon Bonus Effect", (result.bonusSummaries || []).map((summary) => summary.summary).join(" · ") || "(none)"),
                statRow("Bonus Source", getApiStatusLabel()),
                result.debug.calculationNotes.length > 0 && section([renderEntryList(result.debug.calculationNotes)]),
                ...buildBreakdownControls(result),
            ].filter(Boolean));
        });
    }

    /**
     * Updates the open Settings panel without touching the key field.
     * @returns {void}
     */
    function refreshSettingsUi() {
        const panel = document.getElementById(CONFIG.IDS.SETTINGS);
        if (!panel) return;

        const input = panel.querySelector(".tms-ews-api-input");
        input.placeholder = getApiKey() ? "Key saved. Paste a new key to replace it." : "Torn API key";
        panel.querySelector(".tms-ews-status").textContent = [settingsNotice, apiMeta.status].filter(Boolean).join(" ");
        panel.querySelectorAll("[data-tms-ews-busy]").forEach((button) => {
            button.disabled = Boolean(refreshPromise);
        });
    }

    /**
     * Validates and stores a new API key, then loads its bonuses.
     * @param {HTMLInputElement} input Key field.
     * @returns {Promise<void>} Resolves after validation.
     */
    async function saveApiKeyFromInput(input) {
        const key = input.value.trim();
        if (!key) {
            settingsNotice = "Paste a key first.";
            refreshSettingsUi();
            return;
        }

        settingsNotice = "Checking key...";
        refreshSettingsUi();
        try {
            const data = await api.get("/key/info", {}, key);
            setApiKey(key);
            input.value = "";
            Cache.clearApiData();
            Storage.remove(CONFIG.STORAGE_KEYS.BAD_KEY_PROMPT);
            settingsNotice = `Key saved (${describeKeyAccess(data)}).`;
            runApiRefresh(true);
        } catch (error) {
            settingsNotice = `Key not saved. ${error.message || error}`;
        }
        refreshSettingsUi();
    }

    /**
     * Forgets the key and all API data.
     * @returns {void}
     */
    function clearSavedKey() {
        setApiKey("");
        Cache.clearApiData();
        Storage.remove(CONFIG.STORAGE_KEYS.BAD_KEY_PROMPT);
        resetApiState("API key cleared.");
        settingsNotice = "";
        finishApiLoad();
    }

    /**
     * Clears cached API data and reloads it.
     * @returns {void}
     */
    function clearCacheCommand() {
        Cache.clearApiData();
        settingsNotice = "Cache cleared.";
        if (getApiKey()) runApiRefresh(true);
        else refreshSettingsUi();
    }

    /**
     * Opens the Settings panel. The saved key is never placed in the page.
     * @returns {void}
     */
    function openSettings() {
        const { SETTINGS } = CONFIG.IDS;
        if (document.getElementById(SETTINGS)) {
            refreshSettingsUi();
            return;
        }

        const input = createEl("input", {
            className: "tms-ews-api-input",
            attrs: { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "data-lpignore": "true", "data-1p-ignore": "true", "aria-label": "Torn API key" },
        });

        /**
         * Closes the panel.
         * @returns {void}
         */
        const close = () => {
            document.removeEventListener("keydown", onKeydown);
            settingsNotice = "";
            overlay.remove();
        };

        /**
         * Closes the panel when Escape is pressed.
         * @param {KeyboardEvent} event Keyboard event.
         * @returns {void}
         */
        function onKeydown(event) {
            if (event.key === "Escape") close();
        }

        const button = (text, onClick, busy = false) => createEl("button", {
            className: "tms-ews-btn",
            text,
            attrs: { type: "button", ...(busy ? { "data-tms-ews-busy": "1" } : {}) },
            onClick,
        });

        const panel = createEl("div", {
            className: "tms-ews-panel",
            attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Effective Weapon Stats settings" },
        }, [
            createEl("h2", { text: "Effective Weapon Stats" }),
            createEl("div", { text: "Use a key with Minimal Access. It is stored only in Tampermonkey." }),
            createEl("div", { className: "tms-ews-api" }, [
                input,
                button("Save key", () => saveApiKeyFromInput(input), true),
                button("Refresh API", () => runApiRefresh(true), true),
                button("Clear key", clearSavedKey),
                button("Close", () => close()),
            ]),
            createEl("div", { className: "tms-ews-status", attrs: { role: "status", "aria-live": "polite" } }),
        ]);

        const overlay = createEl("div", { id: SETTINGS }, [panel]);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close();
        });
        document.addEventListener("keydown", onKeydown);
        document.body.append(overlay);
        refreshSettingsUi();
        input.focus();
    }

    /**
     * Describes a key's access from the /key/info response.
     * @param {Object} data Response from /key/info.
     * @returns {string} Readable access description.
     */
    function describeKeyAccess(data) {
        const access = data?.info?.access;
        return access?.type ? `${access.type} access` : "access level unknown";
    }

    /**
     * Finds or creates the stats box.
     * @param {HTMLElement} detailPanel Item panel.
     * @param {HTMLElement} previewWrapper Element the box follows.
     * @returns {HTMLElement} Box.
     */
    function ensureBox(detailPanel, previewWrapper) {
        let box = detailPanel.querySelector(`#${CONFIG.IDS.BOX}`);

        if (!box) {
            box = document.createElement("div");
            box.id = CONFIG.IDS.BOX;
            previewWrapper.insertAdjacentElement("afterend", box);
        }

        return box;
    }

    /**
     * Runs one API refresh at a time and reports failures.
     * @param {boolean} force True to skip the cache and cooldown.
     * @returns {Promise<void>} Refresh in progress.
     */
    function runApiRefresh(force) {
        if (refreshPromise) return refreshPromise;

        refreshPromise = loadApiBonusData(force)
            .catch((err) => {
                apiMeta.status = `API refresh failed: ${err.message || err}`;
                lastSig = "";
                update();
            })
            .finally(() => {
                refreshPromise = null;
                lastSig = "";
                update();
            });

        lastSig = "";
        update();

        return refreshPromise;
    }

    /**
     * Reads the opened weapon and redraws the box when inputs change.
     * @returns {void}
     */
    function update() {
        refreshSettingsUi();

        if (observerPaused) {
            updateDeferred = true;
            return;
        }

        refreshAmmoCacheFromLoadout();

        const openedRow = getOpenedWeaponRow();
        const detailPanel = getDetailPanel();
        const propertiesList = getPropertiesList();
        const previewWrapper = getPreviewWrapper();

        if (!openedRow || !detailPanel || !propertiesList || !previewWrapper) return;

        const uid = openedRow.getAttribute("data-armoryid") || "";
        const category = parseCategoryFromDescription(detailPanel, openedRow);
        const slotType = getOpenedWeaponSlot(openedRow);
        const props = parseProps(propertiesList);

        if (!props) return;

        const weaponName = getWeaponName(openedRow, detailPanel);
        const weaponBonus = getWeaponBonus(propertiesList);
        const weaponBonusInfos = parseWeaponBonusInfos(weaponBonus);
        const weaponQuality = getWeaponQuality(propertiesList);
        const mods = parseDirectModsForOpenedWeapon(openedRow, weaponName);
        const ammo = getAmmoBonusesForWeapon(slotType, weaponName, category);
        const applied = getEffectiveBonusBundle(category, weaponName, slotType);

        const sig = [
            uid,
            category,
            slotType,
            props.dmg,
            props.acc,
            props.xp,
            weaponName,
            weaponBonus,
            weaponQuality,
            applied.damagePct,
            applied.accuracyFlat,
            applied.critRatePct,
            applied.hitChancePct,
            bonusData?.throat?.damagePct || 0,
            weaponBonusInfos.map((info) => `${info.name}:${info.value}`).join(","),
            mods.damagePct,
            mods.damageFlat,
            mods.accuracyFlat,
            mods.firstTurnAccuracyFlat,
            mods.critRatePct,
            ammo.ammoType,
            ammo.damagePct,
            ammo.accuracyFlat,
            ammo.staleReason,
            apiMeta.status,
            refreshPromise ? "refreshing" : "idle",
            isBreakdownOpen() ? "open" : "closed"
        ].join("|");

        if (sig === lastSig) return;

        lastSig = sig;

        const result = calculate(category, props, mods, ammo, weaponName, weaponBonus, weaponQuality, slotType);
        if (!result) return;

        renderBox(detailPanel, previewWrapper, result);
    }

    // =========================================================================
    // OBSERVERS
    // =========================================================================

    /**
     * Pauses observer-driven updates while the script changes the page.
     * @param {() => void} fn Change to apply.
     * @returns {void}
     */
    function withObserverPause(fn) {
        observerPaused = true;

        try {
            fn();
        } finally {
            setTimeout(() => {
                observerPaused = false;
                if (updateDeferred) {
                    updateDeferred = false;
                    safeUpdate();
                }
            }, 0);
        }
    }

    /**
     * Schedules one update after a short delay.
     * @returns {void}
     */
    function scheduleUpdate() {
        if (queued || observerPaused) return;

        queued = true;

        setTimeout(() => {
            queued = false;
            safeUpdate();
        }, CONFIG.UPDATE_DELAY_MS);
    }

    /**
     * Runs an update and reports failures without breaking Torn's page.
     * @returns {void}
     */
    function safeUpdate() {
        try {
            update();
        } catch (error) {
            console.error("[Effective Weapon Stats] Update failed.", error);
        }
    }

    /**
     * Checks whether an element is, or contains, the watched weapon or loadout areas.
     * @param {Node} node Node to check.
     * @returns {boolean} True when the node holds a watched area.
     */
    function containsWatchedArea(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const { WATCH_SCOPE } = CONFIG.SELECTORS;
        return node.matches(WATCH_SCOPE) || Boolean(node.querySelector(WATCH_SCOPE));
    }

    /**
     * Decides whether a page change can affect the displayed stats.
     * @param {MutationRecord} mutation Page change.
     * @returns {boolean} True when an update is needed.
     */
    function isRelevantMutation(mutation) {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        if (!target || target.closest(`#${CONFIG.IDS.BOX}`)) return false;
        return Boolean(target.closest(CONFIG.SELECTORS.WATCH_SCOPE))
            || Array.from(mutation.addedNodes).some(containsWatchedArea);
    }

    /**
     * Starts watching the page and stops when it unloads.
     * @returns {void}
     */
    function startObserver() {
        // Torn replaces its item lists when tabs change, so the observer stays on
        // the body and discards everything outside the watched areas. The
        // attribute filter also ignores other scripts' data-* changes.
        const observer = new MutationObserver((mutations) => {
            if (!observerPaused && mutations.some(isRelevantMutation)) scheduleUpdate();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [...CONFIG.OBSERVED_ATTRIBUTES],
        });
        window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    }

    // =========================================================================
    // INIT
    // =========================================================================

    /**
     * Starts the script.
     * @returns {void}
     */
    function init() {
        try {
            migrateLegacyStorage();
            injectStyles();
            GM_registerMenuCommand("Settings", openSettings);
            GM_registerMenuCommand("Clear cache", clearCacheCommand);
            startObserver();
            runApiRefresh(false);
            safeUpdate();

            if (!getApiKey() && !Storage.get(CONFIG.STORAGE_KEYS.SETTINGS_SHOWN, false)) {
                Storage.set(CONFIG.STORAGE_KEYS.SETTINGS_SHOWN, true);
                openSettings();
            }
        } catch (error) {
            console.error("[Effective Weapon Stats] Failed to start.", error);
        }
    }

    init();
})();
