const plans = document.getElementById('pdfMonths');
if (plans) {
  const update = () => {
    const selected = plans.selectedOptions[0];
    const price = Number(selected.dataset.price).toLocaleString('ru-RU');
    const days = selected.dataset.days;
    document.getElementById('checkoutAmount').textContent = price + ' ₽';
    document.getElementById('checkoutPeriod').textContent = 'за ' + days + ' дней';
    document.getElementById('checkoutDetails').textContent = 'Распознавание банковских выписок на ' + days + ' дней. При продлении оставшиеся дни сохраняются. Автосписаний нет.';
    document.getElementById('checkoutSubmit').textContent = plans.form.dataset.test === '1' ? 'Перейти к тестовой оплате' : 'Оплатить ' + price + ' ₽';
  };
  plans.addEventListener('change', update);
  update();
}
