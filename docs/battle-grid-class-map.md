# Battle-Grid Class Map — Reference for a Cause = Class Tactics RPG

**Purpose.** Design reference for a Final-Fantasy-Tactics-style grid RPG using **classic d20 / D&D combat** (d20 attack rolls, save DC = 8 + ability mod, the 6 D&D ability scores) with an **FFT-style class tree gated by prerequisites**, plus the project's unique twist: every class is a **cause** (a charitable endowment), and holding a class requires maintaining a **concentration RATIO** with per-class **strictness** (drift out if diluted).

This document gathers three verified source systems, then synthesizes them into **THE MAP** — an archetype-clustered, tiered template for a cause -> class tree.

All lists below were web-verified against the sources cited at the bottom. Where a source's small-model summary mislabeled a value, it was corrected against canonical SRD text (noted inline).

---

## Part 1 — D&D Classes (the "discipline" base layer)

### 1a. D&D 5e classes (12 core + Artificer = 13)

Primary ability per the 2014 PHB / D&D Beyond. Role uses our taxonomy.

| Class | Primary ability | Role (our taxonomy) |
|---|---|---|
| Barbarian | STR (CON 2nd) | Tank / melee-DPS (rage, frontline brute) |
| Fighter | STR or DEX | Melee-DPS / tank (most extra attacks, flexible) |
| Paladin | STR + CHA | Tank / divine support (smite, auras, lay on hands) |
| Monk | DEX + WIS | Skirmisher / melee-DPS (mobility, flurry, stuns) |
| Rogue | DEX | Skirmisher / ranged (sneak attack, mobility, skills) |
| Ranger | DEX + WIS | Skirmisher / ranged / nature (hunter, beast) |
| Bard | CHA | Support / control (buffs, debuffs, half-caster utility) |
| Cleric | WIS | Divine caster / support (heal, buff, some control) |
| Druid | WIS | Nature caster / control (wildshape, summons, terrain) |
| Sorcerer | CHA | Arcane caster (blaster, metamagic burst) |
| Warlock | CHA | Arcane caster (eldritch blast, short-rest nova) |
| Wizard | INT | Arcane caster / control (broadest spell list) |
| **Artificer** | INT | Gish / support (magic items, turrets, infusions) |

> Artificer requires INT 13 to multiclass; specialists = Alchemist (support/heal), Armorer (tank/gish), Artillerist (ranged/control), Battle Smith (gish + construct pet). Warlock's primary is **CHA** (one search summary mislabeled it INT — corrected here).

### 1b. D&D 3.5 base classes (11)

These are the "iconic" disciplines and the cleanest base-class set for a tree.

| Class | Primary ability | Role (our taxonomy) |
|---|---|---|
| Barbarian | STR (CON) | Tank / melee-DPS (rage, fast, durable) |
| Fighter | STR (DEX) | Melee-DPS / tank (bonus feats = build canvas) |
| Paladin | CHA + STR | Tank / divine hybrid (smite evil, lay on hands) |
| Ranger | DEX/STR + WIS | Skirmisher / ranged / nature (favored enemy, TWF or archery) |
| Monk | WIS + DEX | Skirmisher / melee-DPS (flurry, fast movement, stunning fist) |
| Rogue | DEX (INT) | Skirmisher (sneak attack, skills, mobility) |
| Bard | CHA | Support / arcane (inspire courage buffs, light casting) |
| Cleric | WIS | Divine caster / support / tank (heal, buff, can melee via buffs) |
| Druid | WIS | Nature caster (wildshape + animal companion + full casting) |
| Sorcerer | CHA | Arcane caster (spontaneous blaster) |
| Wizard | INT | Arcane caster / control (prepared, broadest list) |

**Why two editions?** 5e gives the modern, clean 13-role spread (incl. Warlock + Artificer as gish/exotic anchors). 3.5 is the right substrate for the **prestige-class prerequisite math** (BAB, skill ranks, caster level) that we mirror for advanced/exotic tiers.

---

## Part 2 — FFT Job Tree (the prerequisite-chain model)

Source: Final Fantasy Tactics generic jobs, verified across Final Fantasy Wiki, GameFAQs, and Game8 (PSX original + War of the Lions / Ivalice Chronicles additions). Unlock = reaching the listed **level(s)** in the listed **prerequisite job(s)**. This is the canonical example of a gated tactics tree and the closest analog to our cause-tree.

### Tier 0 — Base (no prereq)
| Job | Prereq | Role | Signature |
|---|---|---|---|
| Squire | none | Generalist / support | Throw Stone, Accumulate, Gained JP Up |
| Chemist | none | Support (items) | Use any item at range, Auto-Potion |

### Tier 1 — basic (1 base job, Lv2)
| Job | Prereq | Role | Signature |
|---|---|---|---|
| Knight | Squire Lv2 | Tank / melee | Break skills (weapon/armor/stat shatter) |
| Archer | Squire Lv2 | Ranged | Charge (chargeable bow shots), Concentrate |
| White Mage | Chemist Lv2 | Divine / heal | Cure, Raise, Protect, Shell |
| Black Mage | Chemist Lv2 | Arcane / blaster | Fire/Bolt/Ice tiers, elemental nukes |

### Tier 2 — intermediate (1 Tier-1 job, Lv3)
| Job | Prereq | Role | Signature |
|---|---|---|---|
| Monk | Knight Lv3 | Melee-DPS | Bare-handed bursts, Chakra (self-heal), revive |
| Thief | Archer Lv3 | Skirmisher | Steal (gear/gil/heart), high move/speed |
| Mystic (Oracle) | White Mage Lv3 | Debuff / control | Status inflicts (sleep/confuse/petrify) |
| Time Mage | Black Mage Lv3 | Control / buff | Haste, Slow, Stop, Float, Gravity, Quick |

### Tier 3 — advanced single-line (1 Tier-2 job, Lv3–4)
| Job | Prereq | Role | Signature |
|---|---|---|---|
| Geomancer | Monk Lv4 | Melee / terrain | Geomancy (terrain-keyed attacks), no-penalty move |
| Dragoon | Thief Lv4 | Mobility / burst | **Jump** (leave field, crash down for big dmg) |
| Summoner | Time Mage Lv3 | Arcane AoE | Summon espers (Shiva, Ramuh, Bahamut...) |
| Orator (Mediator) | Mystic Lv3 | Support / control | Talk skills: Invite, Persuade, Mimic-charm |

### Tier 4 — multi-prereq combination jobs (THE KEY PATTERN)
| Job | Prereq (ALL required) | Role | Signature |
|---|---|---|---|
| Samurai | Knight Lv4 + Monk Lv5 + Dragoon Lv2 | Melee-DPS / AoE | Iaido (draw-out katana spirits), Blade Grasp |
| Ninja | Archer Lv4 + Thief Lv5 + Geomancer Lv2 | Skirmisher / burst | Dual-wield, Throw (ranged weapon spam), top speed |
| Arithmetician (Calculator) | White Mage Lv5 + Black Mage Lv5 + Time Mage Lv4 + Mystic Lv4 | Control (exotic) | Math Skill: free spells on units matching number filters |
| Bard (male only) | Summoner Lv5 + Orator Lv5 | Support / buff | Songs (party-wide stat/HP/MP regen) |
| Dancer (female only) | Geomancer Lv5 + Dragoon Lv5 | Debuff / control | Dances (party-wide stat/HP drain on enemies) |

### Tier 5 — capstone / exotic (deep, broad prereqs)
| Job | Prereq | Role | Signature |
|---|---|---|---|
| Mime | Squire Lv8 + Chemist Lv8 + Geomancer Lv5 + Dragoon Lv5 + Orator Lv5 + Summoner Lv5 | Exotic mirror | Mimics ally actions free; no equipment/abilities of own |

### War of the Lions exclusives
| Job | Prereq | Role | Signature |
|---|---|---|---|
| Onion Knight | Squire Lv6 + Chemist Lv6 | Generalist (scales w/ jobs mastered) | No command skills; stats scale with total jobs unlocked |
| Dark Knight | 20 kills + Knight mastered + Black Mage mastered + Dragoon Lv8 + Samurai Lv8 + Ninja Lv8 + Geomancer Lv8 | Gish / melee-arcane | Darkness (HP-cost damage), Unholy Sacrifice |

**Pattern extracted from FFT:**
- Two **base** jobs (physical Squire / magical Chemist) seed two halves of the tree.
- Each step up demands **levels** (investment) in named prereqs, not just XP.
- **Advanced jobs require MULTIPLE prereqs across branches** (Samurai = Knight+Monk+Dragoon; Ninja = Archer+Thief+Geomancer). This is where **niche power builds** are born.
- **Capstones (Mime, Dark Knight)** demand broad, deep investment — the "you earned it" tier.
- The **"leaping death knight"** the brief mentions = literally the FFT pattern: **Dark Knight** (gish capstone) carrying **Dragoon's Jump** (mobility/burst) as a secondary — a cross-branch combo unlocked only after deep multi-line investment.

---

## Part 3 — D&D 3.5 DMG Prestige Classes (the "advanced/exotic" model)

The 3.5 Dungeon Master's Guide carried the **6 original 3.0 prestige classes** and added **10 more = 16 total**. Verified list and requirements below (canonical SRD text via olimot SRD mirror + d20srd; small-model summaries corrected where they cited Pathfinder numbers).

| Prestige class | Key prerequisites (3.5) | Role / archetype |
|---|---|---|
| **Arcane Archer** | Race elf/half-elf; BAB +6; Point Blank Shot, Precise Shot, Weapon Focus (bow); cast 1st-lvl arcane | Ranged gish (magic arrows) |
| **Arcane Trickster** | Non-lawful; Decipher Script 7, Disable Device 7, Escape Artist 7, Knowledge(arcana) 4; cast *mage hand* + 3rd-lvl arcane; sneak attack +2d6 | Skirmisher + arcane (rogue/caster gish) |
| **Archmage** | Knowledge(arcana) 15, Spellcraft 15; Skill Focus(Spellcraft), Spell Focus x2 schools; cast 7th-lvl arcane, know 5th+ from 5 schools | Arcane capstone (apex blaster/control) |
| **Assassin** | Any evil; Disguise 4, Hide 8, Move Silently 8; **must murder someone to join** | Skirmisher / burst (death attack, poison) |
| **Blackguard** | Any evil; BAB +6; Hide 5, Knowledge(religion) 2; Cleave, Improved Sunder, Power Attack; peaceful contact w/ evil outsider | Tank / divine-melee gish (anti-paladin) |
| **Dragon Disciple** | Any nondragon; Knowledge(arcana) 8; Draconic language; cast arcane w/o preparation (spontaneous) | Gish / tank (grows draconic, breath, +STR) |
| **Duelist** | BAB +6; Perform 3, Tumble 5; Dodge, Mobility, Weapon Finesse | Skirmisher / melee finesse (precise strike, parry) |
| **Dwarven Defender** | Race dwarf; any lawful; BAB +7; Dodge, Endurance, Toughness | **Tank** (defensive stance, immovable) |
| **Eldritch Knight** | Proficient all martial weapons; cast 3rd-lvl arcane | **Gish** (fighter + wizard, the canonical melee-caster) |
| **Hierophant** | Knowledge(religion) 15; any metamagic; cast 7th-lvl divine | Divine capstone (special divine powers) |
| **Horizon Walker** | Knowledge(geography) 8; Endurance | Skirmisher / exotic (terrain mastery, planar movement) |
| **Loremaster** | Knowledge(any two) 10 each; 3 metamagic/item-creation feats + Skill Focus(Knowledge); cast 7 different divinations (1 at 3rd+) | Control / support caster (lore, secrets) |
| **Mystic Theurge** | Knowledge(arcana) 6, Knowledge(religion) 6; cast 2nd-lvl divine AND 2nd-lvl arcane | Hybrid caster (dual arcane+divine progression) |
| **Red Wizard** | Race human (Red Wizard of Thay); Spellcraft ranks, 3 metamagic/item-creation feats, specialist wizard barring 2 schools, evil-leaning (FR setting) | Arcane specialist / control (circle magic) |
| **Shadowdancer** | Move Silently 8, Hide 10, Perform(dance) 5; Combat Reflexes, Dodge, Mobility | **Skirmisher / mobility** (shadow jump = teleport, shadow companion) |
| **Thaumaturgist** | Spell Focus(conjuration); cast *lesser planar ally* | Summon/control specialist (improved called creatures) |

> Note: **Red Wizard** is a Forgotten-Realms-flavored human-only specialist; the SRD mirror omitted it but it IS one of the 16 DMG entries (added in 3.5 from the FR Campaign Setting). The original-6 (from 3.0) are: Arcane Archer, Assassin, Blackguard, Dwarven Defender, Loremaster, Shadowdancer. The 10 added in 3.5: Arcane Trickster, Archmage, Dragon Disciple, Duelist, Eldritch Knight, Hierophant, Horizon Walker, Mystic Theurge, Red Wizard, Thaumaturgist.

### d20 Modern "Advanced Classes" structure (alternative model)

d20 Modern (same d20 engine) uses an explicit **three-stage** ladder that is arguably the cleanest template for our purposes:

1. **Basic classes (6)** — keyed one-to-one to the 6 ability scores: Strong (STR), Fast (DEX), Tough (CON), Smart (INT), Dedicated (WIS), Charismatic (CHA). Pure "stat = identity."
2. **Advanced classes (10-tier)** — unlocked by minimum levels/skills/feats drawn from one or two basic classes (e.g. Soldier needs Strong/Tough/Fast levels; Mage; Field Scientist; Martial Artist; Gunslinger). These are the "combine two disciplines" tier.
3. **Prestige classes** — narrow, lore-heavy, strictest entry.

**Takeaway:** d20 Modern proves a **Basic (1 axis) -> Advanced (combine axes) -> Prestige (strict + deep)** ladder works on the d20 chassis — exactly our cause-tree shape.

---

## Part 4 — THE MAP (synthesis)

### 4a. Archetype families (the clusters)

Every class across all three systems collapses into these families. This is the spine of the cause-tree — each cause is tagged to a family, and combos cross families.

| Family | What it does on the grid | D&D 5e/3.5 anchors | FFT anchors | Prestige/exotic anchors |
|---|---|---|---|---|
| **Tank** | Hold front line, soak, lock enemies | Barbarian, Fighter, Paladin | Knight | Dwarven Defender, Blackguard |
| **Melee-DPS** | Close burst damage | Fighter, Barbarian, Monk | Monk, Geomancer, Samurai | Duelist |
| **Mobility / Skirmisher** | Reposition, leap, flank, evade | Rogue, Monk, Ranger | Thief, **Dragoon (Jump)**, Ninja | **Shadowdancer**, Horizon Walker, Arcane Trickster |
| **Ranged** | Damage at distance | Ranger, Rogue | Archer, Ninja (Throw) | Arcane Archer |
| **Arcane caster** | Nukes / spell control | Wizard, Sorcerer, Warlock | Black Mage, Summoner | Archmage, Red Wizard |
| **Divine caster** | Heal / buff / smite | Cleric, Paladin | White Mage | Hierophant |
| **Nature caster** | Terrain, summons, shapeshift | Druid, Ranger | Geomancer (terrain), Summoner | Thaumaturgist |
| **Support / buff** | Make allies stronger | Bard, Cleric, Artificer | Chemist, Bard, Orator | Loremaster |
| **Debuff / control** | Weaken/lock enemies | Wizard, Druid, Bard | Mystic, Time Mage, Dancer, Arithmetician | Loremaster, Red Wizard |
| **Gish / hybrid** | Mix melee + magic | Paladin, Artificer, (Bard) | **Dark Knight**, Samurai (Iaido) | **Eldritch Knight**, **Mystic Theurge**, Dragon Disciple |
| **Niche / exotic** | Rule-bending identity builds | Warlock (pact), Monk | **Mime**, Onion Knight, Arithmetician | Assassin, Horizon Walker |

### 4b. The universal tier / prereq pattern

Every one of the three systems independently lands on the SAME shape:

```
TIER 0  BASE            one discipline, no prereq
        (Squire/Chemist) (5e/3.5 base class) (d20M Basic class)
                |
TIER 1  SPECIALIZE      pick a lane within one discipline
        (Knight, BMage)  reach Lv2-3 in ONE base
                |
TIER 2  ADVANCE         combine 2+ lines; depth gate
        (Samurai needs   (Eldritch Knight = martial + 3rd-lvl arcane)
         3 prereqs)      (d20M Advanced = two Basic classes)
                |
TIER 3  PRESTIGE/EXOTIC strict, deep, identity-locking
        (Mime, Dark      (Archmage: 15+15 skill, 7th-lvl spells)
         Knight)         (Assassin: must murder to enter)
```

Three consistent gating levers, all reusable as **cause-tree concentration mechanics**:
1. **Breadth gate** — must hold N different prereq classes (FFT combo jobs; Mystic Theurge needs BOTH arcane + divine).
2. **Depth gate** — must reach high level/rank in a prereq (Archmage's 15 ranks; Dark Knight's mastered Knight + BMage).
3. **Conduct/identity gate** — a non-numeric flavor lock (Assassin's murder; Blackguard's evil-outsider pact; Dwarven Defender's lawful dwarf). **This maps directly onto our "concentration RATIO + strictness" twist.**

### 4c. TEMPLATE — cause -> class tree

Map the pattern onto **CAUSE = CLASS**. A player locks an endowment into a cause; the cause's **family** sets stats/role; advanced causes require holding **combinations** of base causes at a maintained **ratio**; strictness rises with tier.

**Tier 0 — Single-cause BASE classes (low strictness).**
- One endowment, one cause. Maps 1:1 to a family (like d20 Modern's stat-keyed Basic classes).
- Example seeding: *Clean Water* -> Divine/Support family; *Reforestation* -> Nature family; *Education* -> Arcane/Control (knowledge); *Disaster Relief* -> Mobility/Skirmisher; *Food Security* -> Tank (sustain); *Conservation* -> Ranged/Nature.
- Strictness LOW: tolerate heavy dilution; easy to hold. This is the on-ramp.

**Tier 1 — Cause specialization (within one cause).**
- Deepen a single cause to unlock its focused form (Knight from Squire). E.g. *Clean Water -> Well-Drilling* (burst-heal support) vs *Clean Water -> Watershed* (terrain/control).
- Gate = DEPTH (hold the base cause above a level threshold).

**Tier 2 — Cause-COMBO advanced classes (the niche-build layer).**
- Require holding **2-3 base causes simultaneously at a maintained ratio** (FFT combo jobs; d20M Advanced; Mystic Theurge). This is where **niche power builds** emerge:
  - **Mobility + Burst + Debuff** -> a "Rapid Response" exotic (Disaster Relief + Food Security + Education) = the grid "leaping striker who weakens on landing." Direct analog: **Dragoon's Jump on a debuffer** / **Dancer** (Geomancer+Dragoon).
  - **Gish (melee + arcane)** -> "Field Engineer" (Infrastructure + Education) = the **Eldritch Knight / Dark Knight** slot — and yes, give it a **Jump-style leap** secondary for the brief's **"leaping death knight."**
  - **Dual-caster** -> "Holistic Care" (Health + Education) = **Mystic Theurge** (both schools, both ratios held).
- Gate = BREADTH (multi-cause) **+ RATIO maintenance**. Strictness MEDIUM: drift out if any required cause is diluted below its band.

**Tier 3 — Strict high-investment EXOTICS (capstone causes).**
- Require **broad + deep** holdings AND tight ratio bands (Mime's six prereqs; Archmage's 15/15; Assassin's conduct lock).
- Example: a "Keystone Restoration" class requiring 5+ causes each held above threshold within a narrow concentration band — the **Mime/Onion Knight/Archmage** tier. Highest power, hardest to maintain, drifts out the instant ratios slip.
- Strictness HIGH: the **concentration RATIO** mechanic does the most work here; small dilution = drop to a lower-tier fallback class.

**How "strictness per class" rides on this:**
| Tier | Breadth | Depth | Ratio strictness | FFT/D&D analog |
|---|---|---|---|---|
| 0 Base | 1 cause | low | loose band | Squire / Basic class |
| 1 Specialized | 1 cause | medium | medium band | Knight / Black Mage |
| 2 Combo | 2-3 causes | medium | tight per-cause bands | Samurai / Eldritch Knight |
| 3 Exotic | 4+ causes | high | very tight, multi-band | Mime / Archmage / Dark Knight |

**Where niche power builds live:** Tier 2-3 cross-family combos. The brief's archetypes map cleanly:
- *mobility + burst + debuff* = Dragoon/Ninja/Dancer lineage -> "leaping death knight" = gish-capstone (Dark Knight / Eldritch Knight body) carrying a **Jump (mobility)** secondary and a **debuff (Mystic/Dancer)** secondary, unlocked only by holding 3+ causes at strict ratios.
- *tank + control* = Dwarven Defender + Time Mage -> immovable lockdown cause-build.
- *dual-caster support* = Mystic Theurge + Bard -> the "holistic" hybrid.

---

## Sources

- [Final Fantasy Tactics jobs — Final Fantasy Wiki (Fandom)](https://finalfantasy.fandom.com/wiki/Final_Fantasy_Tactics_jobs)
- [Job List — FFT: The War of the Lions, GameFAQs](https://gamefaqs.gamespot.com/psp/937312-final-fantasy-tactics-the-war-of-the-lions/faqs/76070/job-list)
- [List of All Jobs and Unlock Requirements — Game8 (FFT)](https://game8.co/games/Final-Fantasy-Tactics/archives/542399)
- [List of D&D 3rd edition prestige classes — D&D Lore Wiki (Fandom)](https://dungeonsdragons.fandom.com/wiki/List_of_Dungeons_%26_Dragons_3rd_edition_prestige_classes)
- [Prestige Classes — v3.5 SRD (olimot mirror)](https://olimot.github.io/srd-v3.5/basic-rules-and-legal/prestige-classes.html)
- [Prestige Classes — d20srd.org (canonical 3.5 SRD index)](https://www.d20srd.org/srd/prestigeClasses/shadowdancer.htm)
- [SRD Prestige Classes — dndtools mirror](https://srd.dndtools.org/srd/classes/prestigeClasses.html)
- [Base Classes — 3.5e SRD (35srd.com)](https://www.35srd.com/players/classes/base-classes/)
- [Character Classes (5e) — D&D Beyond](https://www.dndbeyond.com/classes)
- [Artificer — DND 5th Edition (Wikidot)](https://dnd5e.wikidot.com/artificer)
- [D&D 5E (2014) Classes — Primary/Secondary Stat — EN World](https://www.enworld.org/threads/classes-primary-stat-secondary-stat.616720/)

*Compiled 2026-06-22. FFT prereqs cross-verified across three sources (Final Fantasy Wiki, GameFAQs, Game8) — fully consistent. DMG prestige list verified as the original-6 + 10-added = 16; numeric prereqs taken from canonical SRD text. 5e Warlock primary corrected to CHA against a mislabeled search summary.*
