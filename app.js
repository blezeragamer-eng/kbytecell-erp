let ordens = [];

function novaOS() {
  const cliente = prompt("Nome do cliente:");
  const aparelho = prompt("Aparelho:");
  const valor = prompt("Valor:");

  const os = {
    cliente,
    aparelho,
    valor,
    status: "Recebido"
  };

  ordens.push(os);
  render();
}

function render() {
  const lista = document.getElementById("lista");
  lista.innerHTML = "";

  ordens.forEach((os, i) => {
    const div = document.createElement("div");
    div.innerHTML = `
      <b>${os.cliente}</b><br>
      ${os.aparelho}<br>
      R$ ${os.valor}<br>
      Status: ${os.status}<br><br>
    `;
    lista.appendChild(div);
  });
}