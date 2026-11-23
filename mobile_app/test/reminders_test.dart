import 'package:ai_hospital_agent/patient/reminders.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('dosage pattern → reminder times', () {
    expect(timesFromDosage('1-0-1'), ['08:00', '20:00']);
    expect(timesFromDosage('1 - 1 - 1 after food'), ['08:00', '14:00', '20:00']);
    expect(timesFromDosage('0-0-1'), ['20:00']);
    expect(timesFromDosage('twice daily'), ['08:00']);
  });

  test('duration text → days', () {
    expect(daysFromDuration('5 days'), 5);
    expect(daysFromDuration('2 Weeks'), 14);
    expect(daysFromDuration('1 month'), 30);
    expect(daysFromDuration(''), 5);
  });

  test('notification ids are stable and positive', () {
    expect(notificationId('r1', '08:00'), notificationId('r1', '08:00'));
    expect(notificationId('r1', '08:00'), isNot(notificationId('r1', '20:00')));
    expect(notificationId('r1', '08:00'), greaterThanOrEqualTo(0));
  });
}
