import 'package:ai_hospital_agent/db.dart';
import 'package:ai_hospital_agent/patient/health.dart';
import 'package:ai_hospital_agent/screens/insights.dart';
import 'package:flutter_test/flutter_test.dart';

Appt a(String id, String pid, String date, String status, {num fee = 500, String dx = '', bool online = false}) => Appt(id, {
      'patientId': pid, 'patient': pid, 'date': date, 'status': status, 'fee': fee, 'type': online ? 'Online' : 'Offline',
      'summary': {'diagnosis': dx, 'medications': dx.isEmpty ? [] : [{'name': 'Metformin'}]},
    });

void main() {
  test('doctor metrics: new vs returning, outcomes, revenue, diagnoses', () {
    final m = Metrics([
      a('1', 'p1', '2026-01-10', 'Completed', dx: 'Diabetes'), // p1 first seen before the period
      a('2', 'p1', '2026-11-20', 'Completed', dx: 'Diabetes'),
      a('3', 'p2', '2026-11-21', 'No-Show'),
      a('4', 'p3', '2026-11-22', 'Completed', fee: 800, dx: 'Hypertension', online: true),
      a('5', 'p3', '2026-11-23', 'Cancelled'),
    ], '2026-11-01');
    expect(m.total, 4);
    expect(m.patients, 3);
    expect(m.newPatients, 2);
    expect(m.completed, 2);
    expect(m.noShow, 1);
    expect(m.cancelled, 1);
    expect(m.online, 1);
    expect(m.revenue, 1300);
    expect(m.returningPct, 66); // p1 and p3 came back, p2 did not
    expect(m.top(m.diagnoses).first.key, 'Diabetes');
    expect(m.medicines['Metformin'], 2);
  });

  test('lab series: numeric results oldest first, qualitative skipped', () {
    final s = labSeries([
      {'date': '2026-11-20', 'tests': [{'code': 'HB', 'value': '10.5'}, {'code': 'NS1', 'value': 'Positive', 'qualitative': true}]},
      {'date': '2026-10-01', 'tests': [{'code': 'HB', 'value': '12'}]},
    ]);
    expect(s['HB'], [('2026-10-01', 12.0), ('2026-11-20', 10.5)]);
    expect(s.containsKey('NS1'), false);
  });
}
