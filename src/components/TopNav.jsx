import { Link, useLocation } from "react-router-dom";

export default function TopNav() {
  const { pathname } = useLocation();

  const isActive = (p) => (pathname === p ? "active" : "");

  return (
    <header className="topnav">
      <nav className="topnav-inner">
        <Link className={`pill ${isActive("/chat")}`} to="/chat">
          CHAT ROOM
        </Link>

        <Link className={`pill ${isActive("/saved-replies")}`} to="/saved-replies">
          SAVED REPLYS
        </Link>
        <Link className={`pill ${isActive("/programmed-messages")}`} to="/programmed-messages">
          MENSAJERIA PROGRAMADA
        </Link>

        <Link className={`pill ${isActive("/account")}`} to="/account">
          ACCOUNT
        </Link>
        <Link className={`pill ${isActive("/account")}`} to="/account">
          ESTADISTICAS
        </Link>
        <Link className={`pill ${isActive("/account")}`} to="/account">
          CONFIGURACION GENERAL
        </Link>
      </nav>
    </header>
  );
}
