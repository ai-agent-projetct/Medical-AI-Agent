import 'package:ai_hospital_agent/db.dart';
import 'package:flutter_test/flutter_test.dart';

// Mirrors src/slots.test.mjs in the portal — both apps must offer the same slots.
void main() {
  test('to12h', () {
    expect(to12h('00:05'), '12:05 AM');
    expect(to12h('12:00'), '12:00 PM');
    expect(to12h('14:30'), '02:30 PM');
  });

  test('30-min slots inside sessions, booked removed, partial tail dropped', () {
    final slots = generateSlots([
      {'from': '09:00', 'to': '10:45'},
      {'from': '14:00', 'to': '15:00'},
    ], ['09:30 AM']);
    expect(slots, ['09:00 AM', '10:00 AM', '02:00 PM', '02:30 PM']);
  });
}
