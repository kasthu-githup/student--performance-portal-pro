import { Router, Response } from 'express';
import { repo } from '../repository';
import { Student, MentorMeetingNote } from '../../src/types';
import { optionalAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/students - List all students with query filters
router.get('/', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  const { department, year, section, search, status, page = '1', limit = '100' } = req.query;

  let filtered = [...repo.students];

  if (department && department !== 'all') {
    filtered = filtered.filter((s) => s.department.toLowerCase() === String(department).toLowerCase());
  }

  if (year && year !== 'all') {
    filtered = filtered.filter((s) => s.year === Number(year));
  }

  if (section && section !== 'all') {
    filtered = filtered.filter((s) => s.section.toUpperCase() === String(section).toUpperCase());
  }

  if (status && status !== 'all') {
    filtered = filtered.filter((s) => s.accountStatus?.toLowerCase() === String(status).toLowerCase());
  }

  if (search) {
    const q = String(search).toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.regNo.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q)
    );
  }

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.max(1, Math.min(200, parseInt(String(limit), 10) || 100));
  const total = filtered.length;
  const startIndex = (pageNum - 1) * limitNum;
  const paginated = filtered.slice(startIndex, startIndex + limitNum);

  res.json({
    success: true,
    data: paginated,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  });
});

// GET /api/students/:regNo - Single student details
router.get('/:regNo', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
  const { regNo } = req.params;
  const student = repo.students.find((s) => s.regNo.toUpperCase() === regNo.toUpperCase());

  if (!student) {
    return res.status(404).json({ success: false, message: `Student ${regNo} not found` });
  }

  res.json({ success: true, data: student });
});

// POST /api/students - Add new student (Persists to TiDB Cloud & Disk)
router.post('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body as Partial<Student>;

  if (!data.regNo || !data.name || !data.department || !data.email) {
    return res.status(400).json({
      success: false,
      message: 'Registration Number, Name, Department, and Email are required fields',
    });
  }

  const existing = repo.students.find((s) => s.regNo.toUpperCase() === data.regNo!.toUpperCase());
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Student with Register Number ${data.regNo} already exists`,
    });
  }

  const newStudent: Student = {
    id: data.id || `STU-${data.regNo}`,
    regNo: data.regNo.toUpperCase(),
    name: data.name,
    department: data.department,
    year: Number(data.year) || 3,
    semester: Number(data.semester) || 5,
    section: (data.section as 'A' | 'B') || 'A',
    email: data.email,
    phone: data.phone || '',
    dob: data.dob || '2004-01-01',
    bloodGroup: data.bloodGroup || 'O+',
    facultyAdvisor: data.facultyAdvisor || 'Dr. R. Sharma',
    mentor: data.mentor || 'Dr. R. Sharma',
    parentName: data.parentName || '',
    parentPhone: data.parentPhone || '',
    address: data.address || '',
    cgpa: Number(data.cgpa) || 0.0,
    currentSemesterGpa: Number(data.currentSemesterGpa) || 0.0,
    subjects: data.subjects || ['CS8501', 'CS8591', 'CS8592', 'EC8691'],
    marks: data.marks || {},
    assignments: data.assignments || [],
    overallAttendance: data.overallAttendance || {
      present: 0,
      absent: 0,
      od: 0,
      total: 0,
      percentage: 0,
    },
    subjectAttendance: data.subjectAttendance || {},
    performanceRating: data.performanceRating || 'Good',
    facultyRemarks: data.facultyRemarks || 'Newly enrolled autonomous student record.',
    mentorNotes: data.mentorNotes || [],
    accountStatus: 'Active',
  };

  // Add to in-memory, TiDB Cloud database, and persistent storage
  await repo.addStudent(newStudent);

  repo.logAudit(
    'STUDENT_CREATED',
    req.user?.email || 'Institution Admin',
    req.user?.role || 'admin',
    `Registered new student ${newStudent.regNo} (${newStudent.name}) into ${newStudent.department}`,
    req.ip
  );

  res.status(201).json({ success: true, message: 'Student registered and saved to database successfully', data: newStudent });
});

// PUT /api/students/:regNo - Update student profile (Persists to TiDB Cloud & Disk)
router.put('/:regNo', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { regNo } = req.params;
  const student = repo.students.find((s) => s.regNo.toUpperCase() === regNo.toUpperCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  const updates = req.body;
  const updatedStudent = await repo.updateStudent(student.regNo, updates);

  repo.logAudit(
    'STUDENT_UPDATED',
    req.user?.email || 'System Admin',
    req.user?.role || 'admin',
    `Updated student record ${student.regNo} (${student.name})`,
    req.ip
  );

  res.json({ success: true, message: 'Student profile updated successfully in database', data: updatedStudent });
});

// DELETE /api/students/:regNo - Delete student record (Persists to TiDB Cloud & Disk)
router.delete('/:regNo', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { regNo } = req.params;
  const student = repo.students.find((s) => s.regNo.toUpperCase() === regNo.toUpperCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  const success = await repo.deleteStudent(regNo);

  repo.logAudit(
    'STUDENT_DELETED',
    req.user?.email || 'System Admin',
    'admin',
    `De-registered student ${student.name} (${student.regNo})`,
    req.ip
  );

  res.json({ success, message: 'Student removed from institutional register and database' });
});

// POST /api/students/:regNo/mentor-notes - Add mentoring counseling note
router.post('/:regNo/mentor-notes', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { regNo } = req.params;
  const student = repo.students.find((s) => s.regNo.toUpperCase() === regNo.toUpperCase());

  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  const noteData = req.body;
  if (!noteData.discussionSummary) {
    return res.status(400).json({ success: false, message: 'Discussion summary is mandatory' });
  }

  const newNote: MentorMeetingNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    date: noteData.date || new Date().toISOString().split('T')[0],
    regNo: student.regNo,
    studentName: student.name,
    mentorName: req.user?.name || 'Dr. R. Sharma',
    category: noteData.category || 'Academic Performance',
    topics: noteData.topics || '',
    discussionSummary: noteData.discussionSummary,
    actionPlan: noteData.actionPlan || '',
    followUpDate: noteData.followUpDate || '',
  };

  if (!student.mentorNotes) student.mentorNotes = [];
  student.mentorNotes.unshift(newNote);

  await repo.updateStudent(student.regNo, { mentorNotes: student.mentorNotes });

  repo.logAudit(
    'MENTOR_NOTE_ADDED',
    req.user?.email || 'Faculty Mentor',
    req.user?.role || 'faculty',
    `Added counseling note for student ${student.regNo}`,
    req.ip
  );

  res.status(201).json({ success: true, message: 'Mentoring note logged and saved', data: newNote });
});

// PUT /api/students/:regNo/performance - Update performance rating and remarks
router.put('/:regNo/performance', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { regNo } = req.params;
  const { rating, remarks } = req.body;

  const student = repo.students.find((s) => s.regNo.toUpperCase() === regNo.toUpperCase());
  if (!student) {
    return res.status(404).json({ success: false, message: 'Student not found' });
  }

  const updates: Partial<Student> = {};
  if (rating) updates.performanceRating = rating;
  if (remarks !== undefined) updates.facultyRemarks = remarks;

  const updated = await repo.updateStudent(student.regNo, updates);

  repo.logAudit(
    'PERFORMANCE_UPDATED',
    req.user?.email || 'Faculty',
    req.user?.role || 'faculty',
    `Updated performance appraisal for ${student.regNo}: Rating=${rating}`,
    req.ip
  );

  res.json({ success: true, message: 'Performance appraisal updated', data: updated });
});

export default router;
