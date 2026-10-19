# 🎓 Campus Clash – Branding Reference Sheet

---

## 🎨 Color Palette

| Role                 | Color Code | Usage / Notes                           |
| -------------------- | ---------- | --------------------------------------- |
| **Background**       | `#101322`  | Main site background                    |
| **Primary Accent**   | `#ed5858`  | Buttons, highlights, error/special text |
| **Text (Primary)**   | `#F4F6FB`  | Main foreground color (light on dark)   |
| **Text (Secondary)** | `#A4A9C2`  | Subtext, less prominent UI elements     |
| **Card / Panel BG**  | `#1A1F33`  | Grid tiles, highlight containers        |
| **Borders / Lines**  | `#2A2E42`  | Subtle dividers                         |
| **Success Green**    | `#22C37A`  | Wins, positive outcomes                 |
| **Info Blue**        | `#6C9BFF`  | Neutral highlights, focus rings         |
| **Gold Highlight**   | `#E0B341`  | Leaders, awards, attention              |

The source of truth is the `--cc-*` token block at the top of `public/styles.css`; this table mirrors it. If they disagree, the CSS wins.

**The accent follows the sport.** Football (Gridiron) uses the red above. Basketball (Hardwood) swaps it for `#F0833F` orange via `:root[data-sport="basketball"]`. Sport-neutral surfaces (login, invites, the root link preview) use the parent crest, whose accent is `#C9CEE6` (`--cc-muted-bright`).

---

## 🛡️ Marks

* **Look:** flat, clean, three colours per crest (navy, one accent, cream). No textures, no distressing, no gradients inside the mark.
* **Masters** live in `design/brand/` (not publicly served): `crest-gridiron.svg`, `crest-hardwood.svg`, `crest-parent.svg`.
* **Web derivatives** live in `images/`, which is publicly served, so only add a file there once a page references it. The tools in `design/tools/` build them.
* **The navbar wordmark is live CSS type** (Graduate + Pacifico), not an image. Do not replace it with a logo file.

---

## 🖋️ Typography

| Type           | Font       | Style                       |
| -------------- | ---------- | --------------------------- |
| **Primary**    | `Poppins`  | Clean, modern sans-serif    |
| **Display**    | `Graduate` | Sporty serif — optional     |
| **Decorative** | `Pacifico` | Fun script — used sparingly |

All fonts are loaded via Google Fonts.

---

## 📱 UI & Layout

* **Mobile-first** design with `0em` and `64em` media breakpoints
* Layout uses **CSS Grid** and **Flexbox** extensively
* Components:

  * Responsive **tables with sticky headers**
  * **Highlight cards** in 2x2 or horizontal grid
  * **Dropdown menus** for week selection
  * Animated **loading spinners**
  * **Tooltips** and **truncated text** for long team names

---

## 🏈 Tone & Theme

* **Fantasy football**–inspired with a **competitive, humorous edge**
* Use of emojis like 🏟️ 🐗 🏈 for flair
* Occasional **animated UI touches**:

  * Bouncing footballs
  * Floating mascots
  * Flickering stadium lights
* Consistent use of brand colors and modern font hierarchy
* Voice: **Confident**, **friendly**, and a bit **tongue-in-cheek**

---

## 📦 Example Component Colors

| Component               | Color(s) Used                                         |
| ----------------------- | ----------------------------------------------------- |
| **CTA Buttons**         | `#ed5858` with `#F4F6FB` text                         |
| **Tables**              | Background `#F4F6FB`, text `#101322`                  |
| **Team Scores / Cards** | `#1A1F33`, border `#2A2E42`, text `#F4F6FB`           |
| **Chart Lines**         | `#ed5858`, `#6C9BFF`, `#22C37A`, `#E0B341`, `#A4A9C2` |
