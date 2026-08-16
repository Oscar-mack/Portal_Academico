const API_URL = "https://portal-academico-e869.onrender.com";

export async function iniciarSesion(username, password) {
  const response = await fetch(`${API_URL}/api/auth/signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Error al iniciar sesión.");
  }

  return data;
}

export async function obtenerCursos(token) {
  const response = await fetch(`${API_URL}/api/cursos`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Error al obtener los cursos.");
  }

  return data;
}





