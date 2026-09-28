// Shell for pre-auth pages (login, invite accept): centered, no sidebar.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen">{children}</div>;
}
