# Zaisan Trainer Bot

Тусдаа Facebook Page-ийн **админ Messenger bot**. Зорилго нь Zaisan customer bot-ийн system prompt + knowledge файлуудыг **чатаар** засах.

## Хэрхэн ажилладаг вэ

```
Та (trainer) ━━[Messenger]━━▶ Trainer FB Page ━━━▶ Webhook (/webhook)
                                                          │
                                                          ▼
                                                  Trainer Bot (Claude)
                                                          │
                                                          ▼
                              ┌────────────────────────────────────────┐
                              │ pending list (in-memory per PSID)     │
                              │  1. Үнэ асуухад ... гэж засах          │
                              │  2. Барилгын дүр төрх ...              │
                              └────────────────────────────────────────┘
                                                          │
                                          (та "хэрэгжүүлэх" гэх үед)
                                                          ▼
                                          Editor Claude  ──read──▶  GitHub
                                          (file editor)  ◀─commit──    │
                                                                       ▼
                                                     khuygbaataro/Zaisan_Tusul
                                                                       │
                                                                  Render auto-deploy
                                                                  (5-10 минутын дотор customer bot шинэчлэгдэнэ)
```

## Ярилцлагын жишээ

> **Та:** "Хэрэглэгчид 'үнэ хэд?' гэхэд илүү найрсаг хариул. Эхлээд төлбөрийн нөхцлийн ерөнхий мэдээллийг өгөөд дараа нь утсыг өг."
>
> **Bot:** "Ойлголоо. Засвар №1 нэмэгдлээ: Үнэ асуухад эхлээд төлбөрийн нөхцлийн ерөнхий мэдээлэл өгөөд дараа нь утас өг."
>
> **Та:** "Бас A type-ын талбайг 91 м² гэж зас (89.19 биш)."
>
> **Bot:** "Ойлголоо. Засвар №2 нэмэгдлээ: A type-ын талбайг 91 м² болгоно."
>
> **Та:** "Жагсаалт"
>
> **Bot:** "Хүлээгдэж буй засвар (2):
> 1. Үнэ асуухад эхлээд төлбөрийн нөхцлийн ерөнхий мэдээлэл...
> 2. A type-ын талбайг 91 м² болгоно..."
>
> **Та:** "хэрэгжүүлэх"
>
> **Bot:** "Хадгаллаа.
> src/prompts/zaisan-system-prompt.md: https://github.com/.../commit/abc
> src/knowledge/zaisan-high-land.md: https://github.com/.../commit/def
> Render автоматаар 5–10 минутын дотор deploy хийнэ."

## Команд

| Trainer бичих | Bot хийх |
|---|---|
| Засварын мэдэгдэл (чөлөөт хэлбэрээр) | Хүлээгдэж буй жагсаалтад нэмж "Ойлголоо. Засвар №N..." гэж баталгаажуулна |
| "жагсаалт" / "list" | Бүх хүлээгдэж буй засваруудыг тоологдмол байдлаар харуулна |
| "цэвэрлэх" / "арилгах" / "clear" | Жагсаалтыг устгана |
| "хэрэгжүүлэх" / "confirm" / "apply" | Бүх засваруудыг файлуудад хэрэгжүүлж GitHub руу commit хийнэ |

## Хамгаалалт

- **Зөвхөн** `ALLOWED_PSIDS` env var-д бичсэн PSID-уудаас мессеж хүлээж авна
- Эхний удаа deploy хийсний дараа bot руу мессеж бичих → bot нь таны PSID-г хариулна → үүнийг env var-д бичээд redeploy хийнэ
- Зөвхөн 2 файл засагдана: `src/prompts/zaisan-system-prompt.md`, `src/knowledge/zaisan-high-land.md`
- GitHub token-ыг **зөвхөн** Render env var-д хадгална. Code-д хэзээ ч бичигдэхгүй

## Локал хөгжүүлэлт

```bash
npm install
cp .env.example .env
# .env-ийг засаад бодит утгуудаа оруул
npm run dev
```

## Render-д deploy хийх

1. **Render dashboard** → **"New +"** → **"Blueprint"**
2. **Connect repository:** `khuygbaataro/Zaisan_Tuslah`
3. Render `render.yaml`-г уншиж `zaisan-trainer-bot` service үүсгэнэ → **"Apply"**
4. Service үүссэний дараа **Environment** табд орж секретүүдийг тавь:
   - `ANTHROPIC_API_KEY`
   - `FACEBOOK_PAGE_ACCESS_TOKEN` (trainer FB Page-ийн token)
   - `FACEBOOK_APP_SECRET`
   - `FACEBOOK_VERIFY_TOKEN` (дурын string)
   - `GITHUB_TOKEN` (Personal Access Token, `repo` scope)
   - `ALLOWED_PSIDS` (эхлээд хоосон үлдээ, дараа нь PSID-аа нэмнэ)
5. **Facebook Webhook setup:**
   - Trainer Page-аас үүсгэсэн FB App-аас → Messenger → Webhooks
   - Callback URL: `https://zaisan-trainer-bot.onrender.com/webhook`
   - Verify Token: env-д тавьсан `FACEBOOK_VERIFY_TOKEN`
   - Subscribe `messages`
6. Trainer Page-аас Messenger дотор ямар нэг мессеж бичих → bot нь PSID-г хариулна
7. Render → Environment → `ALLOWED_PSIDS`-д тэр PSID-г нэмнэ → "Save changes" (redeploy эхэлнэ)
8. Дараа нь нөгөө мессеж бичихэд bot нь ажиллаж эхэлнэ

## Файлын бүтэц

```
.
├── src/
│   ├── server.ts            ← Express + /webhook
│   ├── claude.ts            ← Орчуулагч-orchestrator (chat AI + tools)
│   ├── applyChanges.ts      ← Editor Claude — файлуудыг бичих
│   ├── github.ts            ← GitHub Contents API (read, commit)
│   ├── facebook.ts          ← FB Send API + signature verify
│   ├── pending.ts           ← Хүлээгдэж буй жагсаалт (in-memory)
│   ├── conversation.ts      ← Chat history (in-memory)
│   ├── auth.ts              ← PSID allowlist
│   └── prompts/
│       └── trainer-system-prompt.md
├── scripts/copy-assets.cjs
├── package.json, tsconfig.json
├── render.yaml, .env.example, .gitignore
└── README.md
```

## Анхааруулга

⚠️ Trainer bot нь production repo руу шууд commit хийдэг. Зөвхөн **итгэлтэй хүн** ашиглах ёстой. Хэрэв GitHub token, FB token гадагшаа алдагдвал нэн даруй **rotate** хий.

⚠️ Засаж буй файлуудын **бүх** агуулга солигдох учир editor Claude алдаа гаргаж болзошгүй. Commit-ийг GitHub дээр хянаж байх, шаардлагатай бол revert хийх.
