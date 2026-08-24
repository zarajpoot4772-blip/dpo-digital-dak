import './globals.css';
export const metadata = { title: 'DPO Digital Dak', description: 'Secure Dak & File Management System' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
 return <html lang="en"><body>{children}</body></html>;
}
