const labels = { inbox: '待整理', queued: '待阅读', reading: '阅读中', read: '已完成', archived: '已归档' };
export async function chooseReadingState(ui, control, value) {
  await (typeof control === 'string' ? ui.getByRole('button', { name: control, exact: true }) : control).click();
  await ui.getByRole('listbox', { name: '阅读状态选项', exact: true }).getByRole('option', { name: labels[value], exact: true }).click();
}
