import { LogService } from './log.service';

describe('LogService', () => {
  let service: LogService;

  beforeEach(() => {
    service = new LogService();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('calls console.log in non-production environment', () => {
    spyOn(console, 'log');
    service.log('test message');
    expect(console.log).toHaveBeenCalledWith('test message', '');
  });

  it('passes object to console.log when provided', () => {
    spyOn(console, 'log');
    const obj = { key: 'value' };
    service.log('with object', obj);
    expect(console.log).toHaveBeenCalledWith('with object', obj);
  });

  it('passes empty string when object is undefined', () => {
    spyOn(console, 'log');
    service.log('no object');
    expect(console.log).toHaveBeenCalledWith('no object', '');
  });
});
