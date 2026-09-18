import { Router, Response } from 'express';
import { repo } from '../repository';
import { FeeRecord } from '../../src/types';
import { optionalAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/fees - List fee records
router.get('/', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  const { studentRegNo, status } = req.query;

  let list = [...repo.fees];

  if (req.user && req.user.role === 'student') {
    list = list.filter((f) => f.studentRegNo.toUpperCase() === req.user!.id.toUpperCase());
  } else if (studentRegNo) {
    list = list.filter((f) => f.studentRegNo.toUpperCase() === String(studentRegNo).toUpperCase());
  }

  if (status && status !== 'all') {
    list = list.filter((f) => f.status.toLowerCase() === String(status).toLowerCase());
  }

  res.json({ success: true, data: list, total: list.length });
});

// POST /api/fees - Create or assign new fee record
router.post('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body as Partial<FeeRecord>;

  if (!data.studentRegNo || !data.totalFee) {
    return res.status(400).json({ success: false, message: 'Student Registration Number and Total Fee are required' });
  }

  const student = repo.students.find((s) => s.regNo.toUpperCase() === data.studentRegNo!.toUpperCase());

  const newFee: FeeRecord = {
    id: data.id || `fee-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    studentRegNo: data.studentRegNo.toUpperCase(),
    studentName: data.studentName || student?.name || 'Student',
    academicYear: data.academicYear || '2026-2027',
    semester: Number(data.semester) || 5,
    tuitionFee: Number(data.tuitionFee) || Number(data.totalFee) * 0.7,
    developmentFee: Number(data.developmentFee) || Number(data.totalFee) * 0.2,
    examFee: Number(data.examFee) || Number(data.totalFee) * 0.1,
    totalFee: Number(data.totalFee),
    paidAmount: Number(data.paidAmount) || 0,
    dueAmount: Number(data.dueAmount) || (Number(data.totalFee) - (Number(data.paidAmount) || 0)),
    status: (data.dueAmount === 0 || (Number(data.paidAmount) >= Number(data.totalFee))) ? 'Paid' : 'Pending',
    noDueApproved: Boolean(data.noDueApproved),
    lastPaymentDate: data.lastPaymentDate || '',
    receiptNumber: data.receiptNumber || '',
  };

  await repo.addFee(newFee);

  res.status(201).json({ success: true, message: 'Fee record created and persisted to database', data: newFee });
});

// POST /api/fees/:id/pay - Record tuition/development fee installment
router.post('/:id/pay', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { amount } = req.body;

  const paymentNum = Number(amount);
  if (isNaN(paymentNum) || paymentNum <= 0) {
    return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
  }

  const fee = repo.fees.find((f) => f.id === id);
  if (!fee) {
    return res.status(404).json({ success: false, message: 'Fee record not found' });
  }

  const newPaid = fee.paidAmount + paymentNum;
  const newDue = Math.max(0, fee.totalFee - newPaid);
  const status = newDue === 0 ? 'Paid' : 'Partial';

  fee.paidAmount = newPaid;
  fee.dueAmount = newDue;
  fee.status = status;
  fee.noDueApproved = newDue === 0;
  fee.lastPaymentDate = new Date().toISOString().split('T')[0];
  fee.receiptNumber = `AIT/26-27/REC-${Math.floor(10000 + Math.random() * 90000)}`;

  await repo.updateFee(fee.id, fee);

  repo.logAudit(
    'FEE_PAYMENT_RECORDED',
    req.user?.email || 'Institution Admin',
    req.user?.role || 'admin',
    `Recorded payment of ₹${paymentNum.toLocaleString()} for student ${fee.studentRegNo}. Balance Due: ₹${newDue.toLocaleString()}`,
    req.ip
  );

  res.json({
    success: true,
    message: `Payment of ₹${paymentNum.toLocaleString()} recorded successfully. Receipt: ${fee.receiptNumber}`,
    data: fee,
  });
});

export default router;
