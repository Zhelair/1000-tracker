
let totals = [0,0,0];
let marriages = [];

document.querySelectorAll(".marriages button").forEach(btn => {
  btn.onclick = () => {
    btn.classList.toggle("active");
  };
});

document.getElementById("previewBtn").onclick = () => {
  const bidder = +bidderEl.value;
  const order = +orderEl.value;
  const pass = passEl.checked;

  let marriageSum = 0;
  document.querySelectorAll(".marriages button.active")
    .forEach(b => marriageSum += +b.dataset.value);

  let delta = [0,0,0];

  if (pass) {
    delta[bidder] = -60;
  } else {
    delta[bidder] = -order + marriageSum;
  }

  previewText.innerText =
    `Заказчик: ${names[bidder]}
Изменение: ${delta.join(", ")}`;

  currentDelta = delta;
  preview.classList.remove("hidden");
};

document.getElementById("confirmBtn").onclick = () => {
  totals = totals.map((t,i) => t + currentDelta[i]);
  updateTotals();
  addHistory(currentDelta);
  preview.classList.add("hidden");
};

document.getElementById("objectBtn").onclick = () => {
  preview.classList.add("hidden");
};

function updateTotals() {
  t1.innerText = totals[0];
  t2.innerText = totals[1];
  t3.innerText = totals[2];
}

function addHistory(delta) {
  const li = document.createElement("li");
  li.innerText = delta.join(", ");
  history.appendChild(li);
}

const names = ["Банкир","Рисковый","Невозмутимый"];
const bidderEl = document.getElementById("bidder");
const orderEl = document.getElementById("order");
const passEl = document.getElementById("pass");
const preview = document.getElementById("preview");
const previewText = document.getElementById("previewText");

let currentDelta = [0,0,0];
