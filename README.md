# ניהול תקציב — הדרשיות

אפליקציית ניהול תקציב אישי לנער בן 14 שמנהל עסק הדרשיות.

## תכונות
- **עובר ושב** — עקוב אחרי יתרת הבנק
- **פיקדון לרשיון** — חיסכון לעתיד
- **תקציב שבועי** — העברה של ₪100 בשבוע + הוצאות מהירות
- **ניהול חובות** — מי חייב לך ועוד כמה
- **Dark Mode** מלא
- **LocalStorage** — הנתונים נשמרים גם אחרי רענון

## הפעלה מקומית

```bash
npm install
npm run dev
```

## בנייה לייצור (לפני המרה ל-APK)

```bash
npm run build
```

## המרה ל-APK עם Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Budget App" "com.hadrshot.budget" --web-dir dist
npm run build
npx cap add android
npx cap sync
npx cap open android
```
לאחר מכן ב-Android Studio: Build → Generate Signed APK
