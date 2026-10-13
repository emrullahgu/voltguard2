import { parseDecimal, parseImportDate } from './operations.mjs';
const editableFields = ['base_salary','overtime_pay','bonus','meal_allowance','transport_allowance','other_earnings','advance_deduction','sgk_employee','unemployment_employee','income_tax','stamp_tax','other_deductions','net_payment','sgk_employer','unemployment_employer','total_employer_cost','worked_days','total_days','paid_leave_days','unpaid_leave_days','sick_leave_days','payment_date','payment_method','is_paid','notes'];

// Preserve the database timestamp exactly, including PostgreSQL microseconds.
// Expense and advance snapshots belong exclusively to the atomic ledger RPCs.
export function buildPayrollSaveRequest(payroll, logs, { logsOnly = false } = {}) {
  if (!payroll || !payroll.employee_id || !Number.isInteger(payroll.month) || !Number.isInteger(payroll.year)) throw Error('Güncel dönem bordrosu yüklenmedi.');
  if (payroll.id && !payroll.updated_at) throw Error('Bordro sürümü eksik. Güncel dönemi yeniden yükleyin.');
  if (!logs || typeof logs !== 'object' || Array.isArray(logs)) throw Error('Puantaj biçimi geçersiz.');
  const payload = { logs };
  if (!logsOnly) for (const field of editableFields) if (payroll[field] !== undefined) payload[field] = payroll[field];
  if(payload.payment_date === '')payload.payment_date=null;
  return { p_employee_id: payroll.employee_id, p_month: payroll.month, p_year: payroll.year,
    p_payload: payload, p_expected_updated_at: payroll.updated_at ?? null };
}

export function isPayrollConflict(error) { return error?.code === 'PT409' || error?.code === '409'; }

export function buildMonthlyPayrollData(employeeId, logRows, expenseRows, month, year) {
  const logs={};
  for(const row of logRows.filter(item=>item.employee_id===employeeId && item.month===month && item.year===year)) {
    const day=Number(row.day);
    if(!Number.isInteger(day)||day<1||day>31)throw Error('Puantajda geçersiz gün var.');
    logs[day]={day,type:row.type,startTime:row.start_time||'',endTime:row.end_time||'',overtimeHours:parseDecimal(row.overtime_hours),description:row.description||''};
  }
  const expenses=[];
  for(const row of expenseRows.filter(item=>item.employee_id===employeeId)) {
    const date=parseImportDate(row.date),amount=parseDecimal(row.amount,null);
    if(!date || amount===null || amount<0)throw Error('Gider veya avansta geçersiz tarih/tutar var.');
    const offset=(year-date.getFullYear())*12+month-date.getMonth();
    const total=row.type==='Avans'?Number(row.installment_total||1):1;
    if(!Number.isInteger(total)||total<1||total>120)throw Error('Avansta geçersiz taksit sayısı var.');
    if(offset<0||offset>=total)continue;
    expenses.push({id:row.id,type:row.type,amount,description:row.description||'',date:row.date,installment_total:total,installment_current:offset+1});
  }
  return {month,year,logs,expenses};
}
