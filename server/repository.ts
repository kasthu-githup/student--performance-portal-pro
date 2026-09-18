import {
  Student,
  Faculty,
  HOD,
  Admin,
  Department,
  Subject,
  AttendanceRecord,
  LeaveRequest,
  Announcement,
  NotificationItem,
  FeeRecord,
  AuditLog,
} from '../src/types';
import {
  INITIAL_STUDENTS,
  INITIAL_FACULTY,
  INITIAL_HOD,
  INITIAL_ADMIN,
  INITIAL_DEPARTMENTS,
  INITIAL_ANNOUNCEMENTS,
  INITIAL_LEAVE_REQUESTS,
  INITIAL_NOTIFICATIONS,
  INITIAL_FEES,
  INITIAL_AUDIT_LOGS,
  SUBJECT_CATALOG,
  generateInitialAttendanceLogs,
} from '../src/data/initialData';
import {
  saveStudentToTiDb,
  deleteStudentFromTiDb,
  saveAttendanceRecordToTiDb,
  saveLeaveRequestToTiDb,
  saveFacultyToTiDb,
  saveAnnouncementToTiDb,
  saveFeeToTiDb,
  saveUserToTiDb,
  saveAuditLogToTiDb,
  loadAllFromTiDb,
  syncAllToTiDb,
} from './db';
import { loadDiskState, saveDiskState } from './storage';

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  role: 'student' | 'faculty' | 'hod' | 'admin';
  name: string;
  status: 'Active' | 'Inactive';
  lastLogin?: string;
  createdAt: string;
}

class InstitutionalRepository {
  public users: UserAccount[] = [
    {
      id: 'ADM001',
      email: 'kasthuricse23@sasurie.com',
      passwordHash: '$2a$10$w099B0LgqM81b1.6k2vRre9R85YxZ2eN.81M7r2kPq9cM9Gz7R8e6', // kasthu123
      role: 'admin',
      name: 'Kasthuri',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLogin: new Date().toISOString(),
    },
    {
      id: 'admin',
      email: 'admin@college.edu',
      passwordHash: '$2a$10$w099B0LgqM81b1.6k2vRre9R85YxZ2eN.81M7r2kPq9cM9Gz7R8e6',
      role: 'admin',
      name: 'Kasthuri',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'FAC001',
      email: 'r.sharma@college.edu',
      passwordHash: 'faculty123',
      role: 'faculty',
      name: 'Dr. R. Sharma',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'HOD001',
      email: 'hod.cse@college.edu',
      passwordHash: 'hod123',
      role: 'hod',
      name: 'Dr. M. Sundararajan',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '2023CSE001',
      email: 'aakash.varma@student.college.edu',
      passwordHash: 'student123',
      role: 'student',
      name: 'Aakash Varma',
      status: 'Active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  public students: Student[] = [...INITIAL_STUDENTS];
  public faculty: Faculty[] = [...INITIAL_FACULTY];
  public hod: HOD = { ...INITIAL_HOD };
  public admin: Admin = { ...INITIAL_ADMIN };
  public departments: Department[] = [...INITIAL_DEPARTMENTS];
  public subjects: Subject[] = [...SUBJECT_CATALOG];
  public attendance: AttendanceRecord[] = generateInitialAttendanceLogs();
  public leaveRequests: LeaveRequest[] = [...INITIAL_LEAVE_REQUESTS];
  public announcements: Announcement[] = [...INITIAL_ANNOUNCEMENTS];
  public notifications: NotificationItem[] = [...INITIAL_NOTIFICATIONS];
  public fees: FeeRecord[] = [...INITIAL_FEES];
  public auditLogs: AuditLog[] = [...INITIAL_AUDIT_LOGS];
  public settings: Record<string, any> = {
    institutionName: 'Park College of Engineering and Technology',
    autonomousAffiliation: 'Autonomous Institution Affiliated to Anna University, Chennai',
    academicYear: '2026-2027',
    currentSemester: 5,
    attendanceThreshold: 75,
    allowStudentProfileEdit: true,
    allowLeaveSubmission: true,
  };

  constructor() {
    this.hydrateFromStorage();
  }

  // Hydrate from disk storage initially
  private hydrateFromStorage() {
    const diskState = loadDiskState();
    if (diskState) {
      if (Array.isArray(diskState.students) && diskState.students.length > 0) {
        this.students = diskState.students;
      }
      if (Array.isArray(diskState.faculty) && diskState.faculty.length > 0) {
        this.faculty = diskState.faculty;
      }
      if (diskState.hod) {
        this.hod = diskState.hod;
      }
      if (Array.isArray(diskState.attendance) && diskState.attendance.length > 0) {
        this.attendance = diskState.attendance;
      }
      if (Array.isArray(diskState.leaveRequests) && diskState.leaveRequests.length > 0) {
        this.leaveRequests = diskState.leaveRequests;
      }
      if (Array.isArray(diskState.announcements) && diskState.announcements.length > 0) {
        this.announcements = diskState.announcements;
      }
      if (Array.isArray(diskState.fees) && diskState.fees.length > 0) {
        this.fees = diskState.fees;
      }
      if (Array.isArray(diskState.users) && diskState.users.length > 0) {
        this.users = diskState.users;
      }
      if (Array.isArray(diskState.auditLogs) && diskState.auditLogs.length > 0) {
        this.auditLogs = diskState.auditLogs;
      }
      console.log('[Repository] Loaded state from local disk persistence.');
    }
  }

  // Reload data from TiDB database if available
  public async hydrateFromDatabase(): Promise<boolean> {
    try {
      const dbData = await loadAllFromTiDb();
      if (dbData && dbData.students && dbData.students.length > 0) {
        this.students = dbData.students;
        if (dbData.faculty) this.faculty = dbData.faculty;
        if (dbData.attendance) this.attendance = dbData.attendance;
        if (dbData.leaveRequests) this.leaveRequests = dbData.leaveRequests;
        if (dbData.announcements) this.announcements = dbData.announcements;
        if (dbData.fees) this.fees = dbData.fees;
        if (dbData.users) this.users = dbData.users;
        this.persistToDisk();
        console.log(`[Repository] Successfully hydrated ${this.students.length} students from TiDB Cloud.`);
        return true;
      }
    } catch (err: any) {
      console.warn('[Repository] TiDB hydration notice:', err.message);
    }
    return false;
  }

  // Persist current state to local storage
  public persistToDisk() {
    saveDiskState({
      users: this.users,
      students: this.students,
      faculty: this.faculty,
      hod: this.hod,
      admin: this.admin,
      departments: this.departments,
      subjects: this.subjects,
      attendance: this.attendance,
      leaveRequests: this.leaveRequests,
      announcements: this.announcements,
      notifications: this.notifications,
      fees: this.fees,
      auditLogs: this.auditLogs,
      settings: this.settings,
    });
  }

  // Add structured audit log
  public logAudit(action: string, performedBy: string, role: string, details: string, ip = '127.0.0.1') {
    const log: AuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      action,
      performedBy,
      userRole: role,
      details,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      ipAddress: ip,
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 200) {
      this.auditLogs.pop();
    }
    this.persistToDisk();
    saveAuditLogToTiDb(log).catch(() => {});
    return log;
  }

  // Recalculate student attendance percentage from attendance records
  public recalculateStudentAttendance(regNo: string) {
    const student = this.students.find((s) => s.regNo.toUpperCase() === regNo.toUpperCase());
    if (!student) return;

    const studentLogs = this.attendance.filter((a) => a.regNo.toUpperCase() === regNo.toUpperCase());
    if (studentLogs.length === 0) return;

    let present = 0;
    let absent = 0;
    let od = 0;

    studentLogs.forEach((rec) => {
      if (rec.status === 'Present') present++;
      else if (rec.status === 'Absent') absent++;
      else if (rec.status === 'OD') od++;
    });

    const total = studentLogs.length;
    const effectiveAttended = present + od;
    const percentage = total > 0 ? Math.round((effectiveAttended / total) * 1000) / 10 : 0;

    student.overallAttendance = {
      present,
      absent,
      od,
      total,
      percentage,
    };

    this.persistToDisk();
    saveStudentToTiDb(student).catch(() => {});
  }

  // -------------------------------------------------------------
  // Data Mutation Handlers (Dual Persistence: Memory + TiDB + Disk)
  // -------------------------------------------------------------

  public async addStudent(newStudent: Student): Promise<void> {
    this.students.unshift(newStudent);

    // Create user login account
    const userAcc: UserAccount = {
      id: newStudent.regNo,
      email: newStudent.email,
      passwordHash: 'student123',
      role: 'student',
      name: newStudent.name,
      status: 'Active',
      createdAt: new Date().toISOString(),
    };
    this.users.push(userAcc);

    this.persistToDisk();

    // Async save to TiDB
    await Promise.all([
      saveStudentToTiDb(newStudent),
      saveUserToTiDb(userAcc),
    ]).catch((err) => {
      console.warn('[Repository] TiDB save warning on addStudent:', err.message);
    });
  }

  public async updateStudent(regNo: string, updates: Partial<Student>): Promise<Student | null> {
    const idx = this.students.findIndex((s) => s.regNo.toUpperCase() === regNo.toUpperCase());
    if (idx < 0) return null;

    this.students[idx] = { ...this.students[idx], ...updates };
    const updated = this.students[idx];

    this.persistToDisk();
    await saveStudentToTiDb(updated).catch((err) => {
      console.warn('[Repository] TiDB save warning on updateStudent:', err.message);
    });

    return updated;
  }

  public async deleteStudent(regNo: string): Promise<boolean> {
    const idx = this.students.findIndex((s) => s.regNo.toUpperCase() === regNo.toUpperCase());
    if (idx < 0) return false;

    this.students.splice(idx, 1);
    this.users = this.users.filter((u) => u.id.toUpperCase() !== regNo.toUpperCase());

    this.persistToDisk();
    await deleteStudentFromTiDb(regNo).catch((err) => {
      console.warn('[Repository] TiDB delete warning:', err.message);
    });

    return true;
  }

  public async saveAttendanceRecords(records: AttendanceRecord[]): Promise<void> {
    const affected = new Set<string>();

    for (const rec of records) {
      const existingIdx = this.attendance.findIndex(
        (a) =>
          a.date === rec.date &&
          a.regNo.toUpperCase() === rec.regNo.toUpperCase() &&
          a.subjectCode.toUpperCase() === rec.subjectCode.toUpperCase()
      );

      if (existingIdx >= 0) {
        this.attendance[existingIdx] = rec;
      } else {
        this.attendance.unshift(rec);
      }
      affected.add(rec.regNo);
      saveAttendanceRecordToTiDb(rec).catch(() => {});
    }

    affected.forEach((regNo) => {
      this.recalculateStudentAttendance(regNo);
    });

    this.persistToDisk();
  }

  public async addLeaveRequest(leave: LeaveRequest): Promise<void> {
    this.leaveRequests.unshift(leave);
    this.persistToDisk();
    await saveLeaveRequestToTiDb(leave).catch(() => {});
  }

  public async updateLeaveRequest(id: string, updates: Partial<LeaveRequest>): Promise<LeaveRequest | null> {
    const idx = this.leaveRequests.findIndex((l) => l.id === id);
    if (idx < 0) return null;

    this.leaveRequests[idx] = { ...this.leaveRequests[idx], ...updates };
    const updated = this.leaveRequests[idx];
    this.persistToDisk();
    await saveLeaveRequestToTiDb(updated).catch(() => {});
    return updated;
  }

  public async addFaculty(fac: Faculty): Promise<void> {
    this.faculty.unshift(fac);

    const userAcc: UserAccount = {
      id: fac.id,
      email: fac.email,
      passwordHash: 'faculty123',
      role: 'faculty',
      name: fac.name,
      status: 'Active',
      createdAt: new Date().toISOString(),
    };
    this.users.push(userAcc);

    this.persistToDisk();
    await Promise.all([
      saveFacultyToTiDb(fac),
      saveUserToTiDb(userAcc),
    ]).catch(() => {});
  }

  public async updateFaculty(id: string, updates: Partial<Faculty>): Promise<Faculty | null> {
    const idx = this.faculty.findIndex((f) => f.id === id);
    if (idx < 0) return null;

    this.faculty[idx] = { ...this.faculty[idx], ...updates };
    const updated = this.faculty[idx];
    this.persistToDisk();
    await saveFacultyToTiDb(updated).catch(() => {});
    return updated;
  }

  public async deleteFaculty(id: string): Promise<boolean> {
    const idx = this.faculty.findIndex((f) => f.id === id);
    if (idx < 0) return false;
    this.faculty.splice(idx, 1);
    this.users = this.users.filter((u) => u.id !== id);
    this.persistToDisk();
    return true;
  }

  public async addAnnouncement(ann: Announcement): Promise<void> {
    this.announcements.unshift(ann);
    this.persistToDisk();
    await saveAnnouncementToTiDb(ann).catch(() => {});
  }

  public async deleteAnnouncement(id: string): Promise<boolean> {
    const idx = this.announcements.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    this.announcements.splice(idx, 1);
    this.persistToDisk();
    return true;
  }

  public async addFee(fee: FeeRecord): Promise<void> {
    this.fees.unshift(fee);
    this.persistToDisk();
    await saveFeeToTiDb(fee).catch(() => {});
  }

  public async updateFee(id: string, updates: Partial<FeeRecord>): Promise<FeeRecord | null> {
    const idx = this.fees.findIndex((f) => f.id === id);
    if (idx < 0) return null;

    this.fees[idx] = { ...this.fees[idx], ...updates };
    const updated = this.fees[idx];
    this.persistToDisk();
    await saveFeeToTiDb(updated).catch(() => {});
    return updated;
  }

  // Push all repository data to TiDB database
  public async syncAllToTiDb(): Promise<{ success: boolean; message: string }> {
    return await syncAllToTiDb({
      students: this.students,
      faculty: this.faculty,
      attendance: this.attendance,
      leaveRequests: this.leaveRequests,
      announcements: this.announcements,
      fees: this.fees,
      users: this.users,
    });
  }
}

export const repo = new InstitutionalRepository();
