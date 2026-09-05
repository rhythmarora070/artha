import { createContext, useContext } from "react";

export type Lang = "en" | "hi";

export const dict: Record<string, Record<Lang, string>> = {
  app_tag: { en: "Your financial memory", hi: "आपकी वित्तीय स्मृति" },
  current_balance: { en: "Current Balance", hi: "वर्तमान बैलेंस" },
  expected_balance: { en: "Expected", hi: "अनुमानित" },
  potential_blind_spot: { en: "Potential Blind Spot", hi: "संभावित ब्लाइंड स्पॉट" },
  money_in: { en: "Money In", hi: "आमदनी" },
  money_out: { en: "Money Out", hi: "खर्च" },
  coverage: { en: "Financial Coverage", hi: "वित्तीय कवरेज" },
  upcoming: { en: "Upcoming", hi: "आगामी" },
  record_money: { en: "Record Money", hi: "पैसा दर्ज करें" },
  ask_artha: { en: "Ask ARTHA", hi: "ARTHA से पूछें" },
  home: { en: "Home", hi: "होम" },
  money: { en: "Money", hi: "पैसा" },
  ask: { en: "Ask", hi: "पूछें" },
  control: { en: "Control", hi: "कंट्रोल" },
  paid: { en: "Paid", hi: "भुगतान" },
  received: { en: "Received", hi: "प्राप्त" },
  what_was_this_for: { en: "What was this for?", hi: "यह किसलिए था?" },
  category: { en: "Category", hi: "श्रेणी" },
  account_source: { en: "Account / Source", hi: "खाता / स्रोत" },
  reference: { en: "Reference (optional)", hi: "संदर्भ (वैकल्पिक)" },
  note: { en: "Note (optional)", hi: "टिप्पणी (वैकल्पिक)" },
  save: { en: "Save", hi: "सेव करें" },
  amount: { en: "Amount", hi: "राशि" },
  transactions: { en: "Transactions", hi: "लेन-देन" },
  no_transactions: { en: "No transactions yet", hi: "अभी कोई लेन-देन नहीं" },
  filter_all: { en: "All", hi: "सभी" },
  records_analyzed: { en: "Records analyzed", hi: "रिकॉर्ड विश्लेषित" },
  exceptions: { en: "Exceptions", hi: "अपवाद" },
  blind_spots: { en: "Blind Spots", hi: "ब्लाइंड स्पॉट्स" },
  high: { en: "HIGH", hi: "उच्च" },
  medium: { en: "MEDIUM", hi: "मध्यम" },
  low: { en: "LOW", hi: "निम्न" },
  recurring: { en: "Recurring", hi: "आवर्ती" },
  loans: { en: "Loans", hi: "लोन" },
  owed_by_me: { en: "I owe", hi: "मुझे देना" },
  owed_to_me: { en: "Owed to me", hi: "मुझे मिलना" },
  suggested: { en: "Suggested questions", hi: "सुझाए गए प्रश्न" },
  ask_placeholder: { en: "Ask about your money…", hi: "अपने पैसे के बारे में पूछें…" },
  send: { en: "Send", hi: "भेजें" },
  thinking: { en: "Thinking…", hi: "सोच रहा है…" },
  language_toggle: { en: "हिन्दी", hi: "English" },
  due: { en: "Due", hi: "देय" },
  add_commitment: { en: "Add commitment", hi: "प्रतिबद्धता जोड़ें" },
  name: { en: "Name", hi: "नाम" },
  frequency: { en: "Frequency", hi: "आवृत्ति" },
  add: { en: "Add", hi: "जोड़ें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
  seed_demo: { en: "Reset demo data", hi: "डेमो डेटा रीसेट" },
  suggested_q1: {
    en: "Where did my money go this month?",
    hi: "इस महीने मेरे पैसे कहाँ गए?",
  },
  suggested_q2: {
    en: "Why is my balance ₹5,000 short?",
    hi: "मेरा बैलेंस ₹5,000 कम क्यों है?",
  },
  suggested_q3: {
    en: "What payments are coming up?",
    hi: "कौन से भुगतान आने वाले हैं?",
  },
  suggested_q4: {
    en: "Can I afford ₹2,000 today?",
    hi: "क्या मैं आज ₹2,000 खर्च कर सकता हूँ?",
  },
  suggested_q5: {
    en: "Show me unexplained transactions",
    hi: "अस्पष्ट लेन-देन दिखाओ",
  },
  suggested_q6_hi: {
    en: "How much will I need next week?",
    hi: "अगले हफ़्ते मुझे कितने पैसे चाहिए होंगे?",
  },
};

export function t(key: string, lang: Lang): string {
  return dict[key]?.[lang] ?? dict[key]?.en ?? key;
}

export const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
}>({ lang: "en", setLang: () => {} });

export function useLang() {
  return useContext(LangContext);
}
