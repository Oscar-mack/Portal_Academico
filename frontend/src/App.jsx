import { useState } from "react";
import { iniciarSesion, obtenerCursos } from "./api/api";
import "./App.css";

function EstadoPago({ exitoso }) {
  return (
    <div className="pagina">
      <h1>{exitoso ? "Pago completado" : "Pago cancelado"}</h1>
      <p>
        {exitoso
          ? "Tu pago fue recibido correctamente."
          : "No se realizó ningún cargo. Puedes intentar el pago nuevamente cuando estés listo."}
      </p>
      <a href="/">Volver al Portal Académico</a>
    </div>
  );
}

function App() {
  if (window.location.pathname === "/pago-exitoso") {
    return <EstadoPago exitoso />;
  }

  if (window.location.pathname === "/pago-cancelado") {
    return <EstadoPago exitoso={false} />;
  }

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [mensaje, setMensaje] = useState("");
  const [cursos, setCursos] = useState([]);
  const [autenticado, setAutenticado] = useState(false);

  const [cargando, setCargando] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();

    setMensaje("");
    setCargando(true);

    try {
      // 1. Iniciar sesión
      const usuario = await iniciarSesion(username, password);

      console.log("Usuario autenticado:", usuario);

      // 2. Guardar JWT
      localStorage.setItem("accessToken", usuario.accessToken);

      // 3. Obtener cursos
      const cursosObtenidos = await obtenerCursos(usuario.accessToken);

      console.log("Cursos obtenidos:", cursosObtenidos);

      setCursos(cursosObtenidos);
      setAutenticado(true);

      setMensaje(
        `Bienvenido ${usuario.username}. Rol: ${usuario.rol}`
      );
    } catch (error) {
      console.error(error);
      setMensaje(error.message);
    } finally {
      setCargando(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem("accessToken");
    setAutenticado(false);
    setCursos([]);
    setMensaje("");
    setUsername("");
    setPassword("");
  }

  return (
    <div className="pagina">

      <h1>Portal Académico</h1>
      <p>Prueba de integración Azure DevOps + GitHub + React</p>

      <h2>Prueba de conexión</h2>

      {!autenticado && (
        <form onSubmit={handleLogin}>

          <div>
            <label>Usuario</label>

            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Escribe tu usuario"
            />
          </div>

          <div>
            <label>Contraseña</label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Escribe tu contraseña"
            />
          </div>

          <button type="submit" disabled={cargando}>
            {cargando ? "Conectando..." : "Iniciar sesión"}
          </button>

        </form>
      )}

      {mensaje && (
        <p>
          {mensaje}
        </p>
      )}

      {autenticado && (
        <button type="button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      )}

      {cursos.length > 0 && (
        <section>

          <h2>Cursos obtenidos desde PostgreSQL</h2>

          {cursos.map((curso) => (
            <article key={curso.id}>

              <h3>{curso.nombre}</h3>

              <p>
                Código: {curso.codigo}
              </p>

              <p>
                Créditos: {curso.creditos}
              </p>

              {curso.gradoCarrera && (
                <p>
                  Carrera: {curso.gradoCarrera.nombre}
                </p>
              )}

            </article>
          ))}

        </section>
      )}

    </div>
  );
}

export default App;


