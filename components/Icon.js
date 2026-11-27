const P = {
  home: "M3 12l9-8 9 8M5 10v10h14V10",
  camp: "M3 11l18-7-7 18-2-8z",
  users: "M9 4.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .7 3.2 2.4 3.6 5.2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  gear: "M12 9a3 3 0 110 6 3 3 0 010-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  plus: "M12 3a9 9 0 110 18 9 9 0 010-18zM12 8v8M8 12h8",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  alert: "M12 3l10 18H2zM12 10v5M12 18v.01",
  li: "M3 3h18v18H3zM8 10v7M8 7v.01M12 17v-4a2 2 0 014 0v4M12 10v7",
  mail: "M3 5h18v14H3zM3 7l9 6 9-6",
  search: "M11 4a7 7 0 110 14 7 7 0 010-14zM20 20l-3.5-3.5",
};
export default function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
