import "./globals.css";

export const metadata = {
  title: "Polymarket Smart Money",
  description: "Track top trader positions and smart money sentiment",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
