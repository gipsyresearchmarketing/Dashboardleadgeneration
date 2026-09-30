-- =====================================================
-- Leads CRM — Supabase schema
-- =====================================================
-- Run this in the Supabase SQL Editor (https://app.supabase.com)
-- =====================================================

-- Optional: drop existing tables if rebuilding
-- DROP TABLE IF EXISTS inbound_emails CASCADE;
-- DROP TABLE IF EXISTS blast_history CASCADE;
-- DROP TABLE IF EXISTS blast_drafts CASCADE;
-- DROP TABLE IF EXISTS audiences CASCADE;
-- DROP TABLE IF EXISTS assets CASCADE;
-- DROP TABLE IF EXISTS activities CASCADE;
-- DROP TABLE IF EXISTS tasks CASCADE;
-- DROP TABLE IF EXISTS leads CASCADE;

-- =====================================================
-- LEADS: contacts + companies combined
-- =====================================================
CREATE TABLE leads (
  id            text PRIMARY KEY,
  type          text NOT NULL CHECK (type IN ('person','company')),
  name          text NOT NULL DEFAULT '',
  company       text NOT NULL DEFAULT '',
  email         text NOT NULL DEFAULT '',
  phone         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'New Lead',
  sales_value   bigint NOT NULL DEFAULT 0,
  notes         text NOT NULL DEFAULT '',
  last_contacted_at timestamptz,
  tags          text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_status_idx ON leads (status);
CREATE INDEX leads_type_idx   ON leads (type);

-- =====================================================
-- AUDIENCES: saved recipient segments
-- =====================================================
CREATE TABLE audiences (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('person','company')),
  description text NOT NULL DEFAULT '',
  lead_ids    text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used   timestamptz
);

CREATE INDEX audiences_type_idx ON audiences (type);

-- =====================================================
-- ASSETS: image library (URLs only — no actual upload)
-- =====================================================
CREATE TABLE assets (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('image','file')),
  name        text NOT NULL,
  url         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used   timestamptz
);

-- =====================================================
-- TASKS (lead tasks / to-dos)
-- =====================================================
CREATE TABLE tasks (
  id          text PRIMARY KEY,
  lead_id     text,
  title       text NOT NULL,
  due_at      timestamptz NOT NULL,
  completed   boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_lead_idx   ON tasks (lead_id);
CREATE INDEX tasks_due_idx    ON tasks (due_at);
CREATE INDEX tasks_done_idx   ON tasks (completed);

-- =====================================================
-- ACTIVITIES (calls, emails, meetings, notes)
-- =====================================================
CREATE TABLE activities (
  id          text PRIMARY KEY,
  lead_id     text NOT NULL,
  type        text NOT NULL CHECK (type IN ('call','email','whatsapp','meeting','note')),
  title       text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activities_lead_idx ON activities (lead_id);

-- =====================================================
-- BLASTS: drafts + history
-- =====================================================
CREATE TABLE blast_drafts (
  id          text PRIMARY KEY,
  channel     text NOT NULL CHECK (channel IN ('email','wa')),
  subject     text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  blocks      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of block objects (image/button/divider/etc.)
  files       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of file attachment objects
  recipients  text[] NOT NULL DEFAULT '{}',          -- lead_ids
  audience_id text,
  send_mode    text NOT NULL DEFAULT 'now' CHECK (send_mode IN ('now','scheduled')),
  scheduled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blast_drafts_channel_idx ON blast_drafts (channel);

CREATE TABLE blast_history (
  id           text PRIMARY KEY,
  channel      text NOT NULL CHECK (channel IN ('email','wa')),
  subject      text,
  body         text,
  message      text,
  blocks       jsonb NOT NULL DEFAULT '[]'::jsonb,
  files        jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipients   text[] NOT NULL DEFAULT '{}',
  audience_id  text,
  audience_name text,
  status       text NOT NULL CHECK (status IN ('sent','scheduled')) DEFAULT 'sent',
  scheduled_at timestamptz,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blast_history_channel_idx ON blast_history (channel);
CREATE INDEX blast_history_status_idx ON blast_history (status);

-- =====================================================
-- INBOUND_EMAILS: received emails (mock data — wired for real webhook later)
-- =====================================================
CREATE TABLE inbound_emails (
  id              text PRIMARY KEY,
  from_email      text NOT NULL,
  from_name       text NOT NULL DEFAULT '',
  to_email        text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  snippet         text NOT NULL DEFAULT '',
  lead_id         text,
  blast_id        text,                          -- optional: reply to which blast
  status          text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','replied','archived')),
  starred         boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz,
  replied_at      timestamptz
);

CREATE INDEX inbound_emails_status_idx ON inbound_emails (status);
CREATE INDEX inbound_emails_lead_idx   ON inbound_emails (lead_id);
CREATE INDEX inbound_emails_received_idx ON inbound_emails (received_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE leads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audiences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE blast_drafts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blast_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_emails   ENABLE ROW LEVEL SECURITY;

-- Allow all for anon (single-user mode). Tighten later when adding auth.
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- This is critical: without explicit grants, the anon role cannot query tables
-- even when RLS policies allow it. RLS only filters rows; it does not grant access.CREATE POLICY "anon_all_leads"          ON leads          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_audiences"      ON audiences      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_assets"        ON assets        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_tasks"         ON tasks         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_activities"    ON activities    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_drafts"        ON blast_drafts  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_history"       ON blast_history FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_inbound"       ON inbound_emails FOR ALL TO anon USING (true) WITH CHECK (true);

-- =====================================================
-- SEED DATA (Indonesian sample data for demos)
-- =====================================================

-- Clear existing data first (idempotent re-run)
TRUNCATE leads, tasks, activities, audiences, assets, blast_drafts, blast_history, inbound_emails CASCADE;

-- 20 sample leads (mix of companies and persons across 6 statuses)
INSERT INTO leads (id, type, name, company, email, phone, status, sales_value, notes, last_contacted_at, tags) VALUES
  ('L-0001','company','Andini Pratiwi','PT Batik Nusantara','andini.pratiwi@batik-nusantara.co.id','+62 812-1101-2233','New Lead',0,'Inbound dari webinar Q3. Tertarik paket Enterprise.','2026-08-18T09:12:00Z', ARRAY['Inbound','Hot']),
  ('L-0002','person','Budi Santoso','Warung Kopi Jago','budi@warkopjago.id','+62 813-2233-4455','Followed Up (WhatsApp)',0,'Minta demo modul POS mobile.','2026-08-19T14:30:00Z', ARRAY['Outbound']),
  ('L-0003','company','Citra Lestari','CV Mitra Sehat','citra.lestari@mitrasehat.com','+62 821-9988-7766','In Negotiation',45000000,'Negosiasi diskon 10% untuk kontrak 12 bulan.','2026-08-20T08:05:00Z', ARRAY['VIP','Decision Maker']),
  ('L-0004','person','Dimas Aryasatya','Toko Dimas Elektronik','dimas@dimaselc.id','+62 858-7766-5544','Followed Up (Email)',0,'Belum buka email kedua, follow up via telpon.','2026-08-17T10:45:00Z', ARRAY['Cold']),
  ('L-0005','company','Erika Wulandari','PT Solusi Digital Asia','erika.w@solusidigital.asia','+62 811-3344-5566','Won/Sales',120000000,'Deal ditutup. Invoice sudah dikirim.','2026-08-15T16:20:00Z', ARRAY['VIP','Repeat']),
  ('L-0006','company','Fajar Nugraha','Klinik Sehat Sentosa','fajar@kliniksehat.co.id','+62 812-5566-7788','Lost',0,'Budget belum tersedia tahun ini.','2026-08-10T11:00:00Z', ARRAY['Outbound']),
  ('L-0007','company','Gita Permatasari','PT Hijau Daun Lestari','gita.permata@hijau-daun.id','+62 813-7788-9900','In Negotiation',75000000,'Tunggu approval direksi.','2026-08-19T13:15:00Z', ARRAY['Decision Maker']),
  ('L-0008','person','Hadi Wijaya','Studio Hadi Kreatif','hadi@studiohadi.com','+62 822-3344-5566','Won/Sales',28000000,'Project onboarding minggu depan.','2026-08-16T09:40:00Z', ARRAY['Referral','Repeat']),
  ('L-0009','person','Indah Sari','CV Sari Rasa Catering','indah.sari@sarirasa.id','+62 857-2211-3344','New Lead',0,'Referral dari customer existing.','2026-08-20T07:30:00Z', ARRAY['Referral','Hot']),
  ('L-0010','company','Joko Riyanto','PT Logistik Cepat Indonesia','joko.riyanto@logistikcepat.co.id','+62 818-1122-3344','Followed Up (WhatsApp)',0,'Respon positif, minta proposal formal.','2026-08-19T17:25:00Z', ARRAY['Outbound']),
  ('L-0011','company','Kartika Maharani','Sekolah Maharani Indonesia','kartika@maharanischool.sch.id','+62 811-9988-7766','Followed Up (Email)',0,'Tertarik modul e-learning, butuh presentasi ke guru.','2026-08-14T15:00:00Z', ARRAY['Inbound']),
  ('L-0012','company','Lutfi Hakim','PT Hakim Manufacturing','lutfi.hakim@hakim-mfg.com','+62 813-4433-2211','Won/Sales',230000000,'Kontrak 2 tahun, payment Q1 sudah diterima.','2026-08-12T10:10:00Z', ARRAY['VIP','Decision Maker','Repeat']),
  ('L-0013','person','Maya Anggraini','Salon Maya Beauty','maya@salonmaya.id','+62 821-6655-4433','New Lead',0,'Lead dari IG Ads, minta follow up besok.','2026-08-20T11:00:00Z', ARRAY['Inbound','Hot']),
  ('L-0014','company','Nanda Pratama','PT Pratama Konstruksi','nanda.pratama@pratamakonstruksi.co.id','+62 818-9090-8080','In Negotiation',95000000,'Bandingkan dengan kompetitor, butuh waktu 1 minggu.','2026-08-19T09:50:00Z', ARRAY['Decision Maker']),
  ('L-0015','company','Olivia Tan','PT Tan Family Mart','olivia.tan@tanmart.co.id','+62 812-3434-5656','Lost',0,'Pilih vendor lain, harga tidak cocok.','2026-08-05T08:30:00Z', ARRAY['Cold']),
  ('L-0016','person','Putu Ananda','Bali Craft Studio','putu.ananda@balicraft.studio','+62 819-1212-3434','Won/Sales',18500000,'Closing cepat, repeat customer potensial.','2026-08-13T13:25:00Z', ARRAY['Referral','Repeat']),
  ('L-0017','company','Qori Hidayatullah','Pesantren Hidayatullah','qori@pesantren-h.id','+62 822-7878-9090','Followed Up (Email)',0,'Minta versi trial 30 hari.','2026-08-18T16:40:00Z', ARRAY['Inbound']),
  ('L-0018','company','Rini Hartono','CV Hartono Furniture','rini.hartono@hartono-furnitur.id','+62 813-5656-7878','In Negotiation',62000000,'Negosiasi metode pembayaran termin.','2026-08-20T10:15:00Z', ARRAY['VIP','Repeat']),
  ('L-0019','person','Surya Pranata','PT Surya Energy','surya.pranata@suryaenergy.co.id','+62 811-2323-4545','New Lead',0,'Cold lead dari LinkedIn outreach.','2026-08-20T06:50:00Z', ARRAY['Outbound','Cold']),
  ('L-0020','person','Tantri Wulandari','Tantri Wedding Organizer','tantri@tantriwo.com','+62 857-1010-2020','Followed Up (WhatsApp)',0,'Tertarik tapi budget terbatas, tawarkan paket lite.','2026-08-19T19:05:00Z', ARRAY['Referral']);

-- 12 sample tasks (mix of overdue / due today / completed)
INSERT INTO tasks (id, lead_id, title, due_at, completed, completed_at, notes) VALUES
  ('T-1','L-0001','Kirim email follow-up #1','2026-08-20T17:00:00Z',false,null,'Inbound dari webinar Q3.'),
  ('T-2','L-0003','Siapkan revisi proposal final','2026-08-21T10:00:00Z',false,null,'Sudah incorporate diskon 7%'),
  ('T-3','L-0009','Schedule demo via Zoom','2026-08-20T20:00:00Z',false,null,'Hot lead dari referral'),
  ('T-4','L-0010','Kirim proposal formal','2026-08-21T14:00:00Z',false,null,'Pakai template enterprise'),
  ('T-5','L-0007','Reminder approval direksi','2026-08-22T09:00:00Z',false,null,'Tunggu approval'),
  ('T-6','L-0013','Follow up Instagram Ads lead','2026-08-19T17:00:00Z',true,'2026-08-19T16:45:00Z','Sudah follow up via IG DM'),
  ('T-7','L-0002','Siapkan environment demo POS','2026-08-20T12:00:00Z',true,'2026-08-20T09:30:00Z','Sandbox sudah ready'),
  ('T-8','L-0014','Buat comparison sheet vs kompetitor','2026-08-22T15:00:00Z',false,null,'Cocokkan fitur dengan vendor lain'),
  ('T-9','L-0017','Setup trial account 30 hari','2026-08-21T11:00:00Z',false,null,'Inbound lead'),
  ('T-10','L-0019','Riset use case energy industry','2026-08-23T10:00:00Z',false,null,'Cold lead'),
  ('T-11','L-0004','Telepon follow-up email','2026-08-19T15:00:00Z',false,null,'Belum buka email kedua'),
  ('T-12','L-0011','Siapkan deck presentasi e-learning','2026-08-18T10:00:00Z',false,null,'Untuk pitch ke kepala sekolah');

-- 11 sample activities
INSERT INTO activities (id, lead_id, type, title, notes, created_at) VALUES
  ('A-1','L-0003','call','Diskusi diskon kontrak','Client minta 10%, kita offer 5% + bonus training.','2026-08-19T10:15:00Z'),
  ('A-2','L-0003','email','Kirim draft proposal v2','Proposal v2 sudah dikirim dengan revisi harga.','2026-08-20T08:00:00Z'),
  ('A-3','L-0005','meeting','Final presentation','Presentasi ke direksi, semua setuju dengan paket.','2026-08-14T13:00:00Z'),
  ('A-4','L-0005','whatsapp','Konfirmasi PO','PO sudah dikonfirmasi via WA dengan finance.','2026-08-15T16:15:00Z'),
  ('A-5','L-0009','whatsapp','Welcome chat','Sapa awal + tanyakan kebutuhan spesifik.','2026-08-20T07:35:00Z'),
  ('A-6','L-0012','email','Invoice termin 1','Kirim invoice termin 1, payment received.','2026-08-12T11:00:00Z'),
  ('A-7','L-0012','note','Catatan internal','Account strategis — quarterly check-in.','2026-08-12T10:30:00Z'),
  ('A-8','L-0001','email','Kirim welcome email','Email pertama + link ke calendly demo.','2026-08-18T09:30:00Z'),
  ('A-9','L-0018','call','Follow-up termin','Sudah sepakati termin 30-60-30 hari.','2026-08-20T10:20:00Z'),
  ('A-10','L-0018','meeting','Demo ke owner','Owner tertarik, minta dipresentasikan ke finance.','2026-08-19T15:00:00Z'),
  ('A-11','L-0013','meeting','Demo awal','Demo awal di salon, owner antusias.','2026-08-19T13:00:00Z');

-- A couple of sample audiences
INSERT INTO audiences (id, name, type, description, lead_ids, created_at) VALUES
  ('A-001','VIP customers','person','Customers tagged VIP and Repeat', ARRAY['L-0002','L-0008','L-0016','L-0012'],'2026-08-15T10:00:00Z'),
  ('A-002','B2B prospects Q3','company','Companies in In Negotiation or Followed Up', ARRAY['L-0001','L-0003','L-0007','L-0010','L-0014','L-0018'],'2026-08-10T11:00:00Z');

-- A few sample image assets (URLs only — no actual upload)
INSERT INTO assets (id, kind, name, url, created_at) VALUES
  ('AS-001','image','Q3 Promo Banner','https://picsum.photos/seed/q3promo/600/250', '2026-08-15T10:00:00Z'),
  ('AS-002','image','Hero Image Sample','https://picsum.photos/seed/hero/600/200', '2026-08-14T11:00:00Z'),
  ('AS-003','file','Pricing PDF','pricing-2026-q3.pdf', '2026-08-13T09:00:00Z');

-- =====================================================
-- INBOUND EMAIL SEED (mock — replies from real leads)
-- =====================================================
INSERT INTO inbound_emails (id, from_email, from_name, to_email, subject, body, snippet, lead_id, blast_id, status, starred, has_attachments, received_at) VALUES
  ('INB-001','citra.lestari@mitrasehat.com','Citra Lestari','sales@leadsdashboard.id','Re: Proposal Kerjasama CV Mitra Sehat','Halo Tim Sales,

Terima kasih atas proposal v2 yang dikirimkan kemarin. Sudah saya review dan didiskusikan dengan tim finance.

Secara umum kami setuju dengan skema pricing yang ditawarkan, namun ada beberapa hal yang perlu kita bicarakan lebih lanjut:

1. Untuk diskon 7% yang ditawarkan, kami butuh ini dinaikkan menjadi minimal 10% karena budget tahun ini sudah locked.
2. Modul training implementasi yang disebutkan di halaman 5 — bisa tolong jelaskan apakah ini on-site atau remote?
3. Apakah bisa ada grace period 30 hari sebelum payment termin pertama?

Mohon konfirmasinya. Saya available untuk call di hari Selasa atau Kamis sore.

Best regards,
Citra Lestari
Finance Director, CV Mitra Sehat','Re: Proposal Kerjasama — setuju pricing, minta diskusi diskon & grace period lebih lanjut','L-0003',NULL,'unread',true,false,'2026-09-29T16:42:00Z'),

  ('INB-002','joko.riyanto@logistikcepat.co.id','Joko Riyanto','sales@leadsdashboard.id','Re: Proposal Enterprise - PT Logistik Cepat Indonesia','Selamat pagi,

Setelah saya presentasikan proposal Anda ke board of directors minggu lalu, response-nya positif. Kami tertarik untuk move forward ke tahap POC (proof of concept).

Beberapa pertanyaan teknis:
- Apakah modul fleet management Anda support integrasi dengan GPS tracking kami saat ini (Geotab)?
- Berapa lama waktu implementasi typical untuk fleet 50+ vehicles?
- Apakah ada referensi client di industri logistics/logistik?

Mohon schedule demo dengan technical team kami.

Salam,
Joko Riyanto
CTO, PT Logistik Cepat Indonesia','Re: Proposal Enterprise — board approve POC, butuh klarifikasi integrasi GPS & timeline','L-0010',NULL,'unread',true,false,'2026-09-29T14:15:00Z'),

  ('INB-003','maya@salonmaya.id','Maya Anggraini','sales@leadsdashboard.id','Tertarik dengan paket Mobile POS','Halo! Saya Maya dari Salon Maya Beauty di BSD.

Tadi pagi saya lihat iklan Instagram Anda tentang paket Mobile POS untuk salon & beauty business. Saya tertarik banget karena saya lagi struggle sama sistem pencatatan yang masih manual.

Bisa tolong info lebih detail:
- Harga paket mobile POS berapa ya?
- Apakah bisa integrasi dengan payment gateway (OVO, GoPay, Dana)?
- Ada free trial ga?

Mohon dikirim pricelist + demo video nya.

Terima kasih,
Maya Anggraini
Owner, Salon Maya Beauty','Inquiry dari Instagram Ads — tertarik Mobile POS, minta pricelist + demo video','L-0013',NULL,'unread',false,false,'2026-09-30T08:22:00Z'),

  ('INB-004','qori@pesantren-h.id','Ustadz Qori Hidayatullah','sales@leadsdashboard.id','Trial Account - Pesantren Hidayatullah','Assalamualaikum,

Saya Ustadz Qori dari Pesantren Hidayatullah Yogyakarta. Kami sedang membutuhkan sistem untuk manage data siswa + pembayaran SPP.

Saya sudah mencoba daftar trial 30 hari sesuai instruksi tim Anda. Namun sampai sekarang (3 hari kemudian) belum ada email konfirmasi yang masuk. Mohon dicekan.

Juga tolong informasikan:
- Berapa biaya implementasi awal?
- Apakah ada diskon khusus untuk institusi pendidikan pesantren?
- Bisa custom modul bahasa Arab?

Wassalam,
Ustadz Qori','Trial account belum aktif — minta follow up + info harga & diskon pesantren','L-0017',NULL,'unread',false,false,'2026-09-29T10:05:00Z'),

  ('INB-005','indah.sari@sarirasa.id','Indah Sari','sales@leadsdashboard.id','Re: Welcome to LeadsDashboard','Halo,

Terima kasih atas welcome email-nya. Saya Indah dari CV Sari Rasa Catering, di-referensikan oleh Bu Tantri (Tantri Wedding Organizer).

Kami butuh sistem untuk manage:
1. Order catering harian & event
2. Schedule kitchen + delivery team
3. Customer database untuk repeat order

Apakah LeadsDashboard bisa handle use case catering? Beda dengan wedding organizer kan? Mohon penjelasan.

Saya available untuk demo online Kamis depan jam 14:00 WIB.

Salam,
Indah Sari
Owner, CV Sari Rasa Catering','Re: Welcome — di-referral Bu Tantri, butuh catering management, available demo Kamis','L-0009',NULL,'read',false,false,'2026-09-28T19:30:00Z'),

  ('INB-006','rini.hartono@hartono-furnitur.id','Rini Hartono','sales@leadsdashboard.id','Re: Termin Pembayaran - CV Hartono Furniture','Dear Tim Sales,

Saya Rini Hartono. Sudah kita sepakati skema termin 30-60-30 untuk kontrak furniture kantor baru.

Namun setelah saya berdiskusi dengan finance team, mereka minta revisi:
- Termin 1: 40% (sebelumnya 30%)
- Termin 2: 40% (sebelumnya 60%)
- Termin 3: 20% (sebelumnya 30%)

Apakah ini bisa di-approve? Kita bisa proceed dengan PO minggu depan kalau sudah deal.

Mohon responnya segera karena vendor lain juga sudah offering skema serupa.

Best,
Rini Hartono','Re: Termin — finance minta revisi 40-40-20, butuh approval cepat untuk PO minggu depan','L-0018',NULL,'read',false,false,'2026-09-30T09:15:00Z'),

  ('INB-007','noreply@linkedin.com','LinkedIn','sales@leadsdashboard.id','You have 23 new profile views this week','Hi Bagas,

Your profile was viewed by 23 professionals this week, including:
- Surya Pranata (Energy Industry Manager at PT Surya Energy)
- Dimas Aryasatya (Owner, Toko Dimas Elektronik)

Upgrade to Premium to see all viewers and reach out directly.

Best,
The LinkedIn Team','LinkedIn notification — 23 profile views, termasuk 2 leads hot dari inbox Anda',NULL,NULL,'read',false,false,'2026-09-29T07:00:00Z'),

  ('INB-008','lutfi.hakim@hakim-mfg.com','Lutfi Hakim','sales@leadsdashboard.id','Konfirmasi Renewal Kontrak Tahap 2','Halo Tim LeadsDashboard,

Bersamaan dengan email ini saya ingin konfirmasi bahwa PT Hakim Manufacturing akan proceed dengan renewal kontrak tahap 2 untuk periode 2026-2027.

Beberapa hal yang sudah disetujui internal kami:
- Volume sama dengan kontrak tahun 1
- Tambahan 5 user seats untuk divisi baru
- Modul HR integration (sesuai diskusi bulan lalu)

Mohon kirim invoice renewal selambat-lambatnya 1 Oktober 2026.

Terima kasih atas partnership-nya selama ini.

Best regards,
Lutfi Hakim
Managing Director, PT Hakim Manufacturing','Konfirmasi renewal kontrak tahun 2 + tambah 5 seats + modul HR','L-0012',NULL,'read',true,true,'2026-09-30T10:45:00Z'),

  ('INB-009','tantri@tantriwo.com','Tantri Wulandari','sales@leadsdashboard.id','Referral: CV Sari Rasa Catering','Halo!

Saya Tantri, customer setia LeadsDashboard sejak 2024. Saya mau referensikan kolega saya, Indah Sari dari CV Sari Rasa Catering.

Mereka butuh sistem manage order catering dan schedule kitchen. Saya sudah kasih tau dia untuk kontak sales@leadsdashboard.id langsung.

Tolong follow up ya. Kalau closing, jangan lupa kasih tahu saya — saya dengar ada program referral bonus kan? 😊

Salam,
Tantri Wulandari
Tantri Wedding Organizer','Referral dari Tantri WO — CV Sari Rasa Catering butuh catering management system','L-0020',NULL,'replied',false,false,'2026-09-27T15:20:00Z'),

  ('INB-010','erika.w@solusidigital.asia','Erika Wulandari','sales@leadsdashboard.id','Testimonial & Case Study Permission','Halo Tim,

Saya Erika dari PT Solusi Digital Asia. Kita sudah closing deal 2 minggu lalu dan tim sudah mulai implementasi.

Saya sangat puas dengan onboarding process dan responsiveness tim support Anda. Saya ingin menulis testimonial untuk website Anda dan publish case study kita sebagai referensi.

Apakah tim marketing Anda bisa schedule call 30 menit minggu depan untuk discuss? Saya juga tertarik untuk join sebagai reference customer untuk prospect baru di industri SaaS / digital agency.

Best,
Erika Wulandari
CEO, PT Solusi Digital Asia','Post-sale follow up — Erika mau tulis testimonial & jadi reference customer','L-0005',NULL,'replied',true,false,'2026-09-26T11:30:00Z');
