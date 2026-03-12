import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";

const savedLanguage = localStorage.getItem("i18nLanguage") || "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: savedLanguage,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already handles XSS
  },
});

// Persist language changes to localStorage
i18n.on("languageChanged", (lng: string) => {
  localStorage.setItem("i18nLanguage", lng);
  document.documentElement.lang = lng;
});

// Set initial lang attribute
document.documentElement.lang = savedLanguage;

export default i18n;
