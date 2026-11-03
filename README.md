# Мій календар консультацій

Персональний PWA-календар для iPhone без логіна та пароля. Інтерфейс — українською; часові пояси — Тбілісі, Київ і Варшава. Дані зберігаються в Supabase, сайт розгортається через GitHub + Vercel.

## Режим без авторизації — важливе попередження

У цьому варіанті будь-хто, хто знає адресу сайту, може читати, створювати, змінювати та видаляти всі консультації і push-підписки. Посилання не є паролем. Не зберігай чутливі персональні дані клієнтів. Якщо потрібна приватність, необхідно повернути авторизацію.

## Важливі обмеження, які потрібно знати

- Push на iPhone підтримується для вебзастосунків, доданих на головний екран, на iOS/iPadOS 16.4 або новіших версіях. Потрібно відкрити саме встановлену іконку й дозволити сповіщення.
- Push залежить від дозволу iOS, інтернету, стану push-сервісу Apple та активності Supabase. Це не еквівалент системного будильника і не дає абсолютної гарантії доставки.
- Supabase Free може призупиняти проєкти після періоду низької активності та не включає автоматичні щоденні резервні копії. У застосунку є кнопка експорту JSON; регулярно зберігай цей файл у безпечному місці. Для критично важливих даних варто перейти на платний тариф із backups.
- Не додавай у нотатки зайві чутливі персональні дані клієнтів.

## 1. Створи Supabase-проєкт

1. Зареєструйся на https://supabase.com і створи новий проєкт.
2. У Project Settings → API скопіюй Project URL і publishable/anon key.
3. В Authentication → Users створи одного користувача (свій email і пароль). Публічну реєстрацію в застосунку не передбачено.
4. Відкрий SQL Editor і виконай повністю файл `supabase/schema.sql`.
5. У Authentication → URL Configuration додай адресу Vercel у Site URL і Redirect URLs (наприклад `https://your-project.vercel.app/**`).

## 2. Увімкни доступ без авторизації для вже створеної бази

Після першого SQL `schema.sql` відкрий SQL Editor і виконай файл `supabase/public-mode-migration.sql`. Він змінює RLS-політики так, щоб роль `anon` могла читати та змінювати дані. Це робить записи публічно доступними всім відвідувачам сайту.

## 3. Створи VAPID-ключі для push

На комп'ютері з Node.js виконай:

```bash
npx web-push generate-vapid-keys
```

Збережи обидва ключі. Публічний ключ піде у Vercel як `VITE_VAPID_PUBLIC_KEY`. Приватний ключ — тільки в Supabase Edge Function Secrets. Ніколи не додавай приватний ключ у фронтенд або GitHub.

## 4. Завантаж проєкт на GitHub

Розпакуй ZIP, створи приватний GitHub repository і завантаж усі файли. Не додавай `.env` з реальними ключами до GitHub.

Через термінал у папці проєкту:

```bash
npm install
npm run build
```

## 5. Розгорни на Vercel

1. Увійди на https://vercel.com → Add New → Project.
2. Імпортуй GitHub repository.
3. Framework Preset: Vite.
4. Додай Environment Variables:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = publishable/anon key
   - `VITE_VAPID_PUBLIC_KEY` = VAPID public key
5. Натисни Deploy.

Після зміни Environment Variables зроби Redeploy.

## 6. Розгорни Edge Function для нагадувань

Встанови Supabase CLI, увійди та прив'яжи проєкт:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
  CRON_SECRET="MAKE_A_LONG_RANDOM_SECRET" \
  VAPID_PUBLIC_KEY="YOUR_VAPID_PUBLIC_KEY" \
  VAPID_PRIVATE_KEY="YOUR_VAPID_PRIVATE_KEY" \
  VAPID_SUBJECT="mailto:YOUR_EMAIL"
supabase functions deploy send-reminders --no-verify-jwt
```

`SUPABASE_SERVICE_ROLE_KEY` знайдеш у Project Settings → API Keys. Це секрет із повним доступом до БД — не вставляй його у Vercel frontend variables, код клієнта або GitHub.

## 7. Увімкни щохвилинну перевірку нагадувань

У Supabase Dashboard → SQL Editor виконай (заміни значення):

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'project_url'
);

select vault.create_secret(
  'YOUR_SUPABASE_SERVICE_ROLE_KEY',
  'service_role_key'
);

select vault.create_secret(
  'MAKE_A_LONG_RANDOM_SECRET',
  'cron_secret'
);

select cron.schedule(
  'send-consultation-reminders-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $$
);
```

Переконайся, що розширення `pg_cron`, `pg_net` і `supabase_vault` увімкнені. Якщо `vault.create_secret` недоступна, увімкни Vault у Dashboard або збережи секрети через відповідний розділ Vault. Перевір запуск у Database → Cron → Jobs/Run history.

**Чому Supabase Cron, а не Vercel Cron:** на Vercel Hobby cron виконується лише раз на день, що не підходить для нагадувань за 30 хвилин. Supabase Cron може запускати задачу щохвилини.

## 8. Додай на iPhone

1. Відкрий адресу Vercel у Safari на iPhone.
2. Натисни Share → Add to Home Screen → Add.
3. Запусти календар з нової іконки на головному екрані.
4. Увійди.
5. Натисни іконку дзвіночка та дозволь сповіщення.

Для iOS потрібна версія 16.4 або новіша. Дозвіл на push потрібно запитувати після натискання кнопки — саме так працює кнопка-дзвіночок у застосунку.

## 9. Резервна копія

У верхній панелі застосунку натискай кнопку завантаження — вона збереже всі консультації у JSON. Робити це рекомендовано регулярно. Для імпорту JSON назад потрібен окремий інструмент імпорту; зараз у першій версії реалізовано експорт.

## Поточна версія

Це стартова версія з:
- відкриттям календаря без логіна та пароля (публічний режим);
- календарем місяць/тиждень/день/список;
- створенням, редагуванням, видаленням;
- drag-and-drop перенесенням;
- вибором Europe/Kyiv, Europe/Warsaw, Asia/Tbilisi;
- показом часу консультації у Тбілісі;
- збереженням у Supabase;
- push-підпискою та серверним надсиланням нагадувань;
- експортом резервної копії.

Після першого розгортання обов'язково перевір тестову консультацію на 35–40 хвилин уперед і переконайся, що push реально приходить на iPhone.
