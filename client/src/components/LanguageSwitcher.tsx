import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const languages = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();

  const handleChange = (value: string) => {
    i18n.changeLanguage(value);
  };

  if (compact) {
    return (
      <Select value={i18n.language} onValueChange={handleChange}>
        <SelectTrigger className="w-auto h-8 px-2 gap-1 text-xs border-none shadow-none bg-transparent hover:bg-accent">
          <Globe className="w-4 h-4" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={i18n.language} onValueChange={handleChange}>
      <SelectTrigger className="w-[140px] h-9" aria-label={t("language.selectLanguage")}>
        <Globe className="w-4 h-4 mr-1" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
