#include <sys/resource.h>
int native_usage(double *out) {
 struct rusage r;
 if (getrusage(RUSAGE_SELF, &r)) return -1;
 out[0]=r.ru_utime.tv_sec*1000000.0+r.ru_utime.tv_usec;
 out[1]=r.ru_stime.tv_sec*1000000.0+r.ru_stime.tv_usec;
 out[2]=r.ru_majflt;out[3]=r.ru_minflt;out[4]=r.ru_nvcsw;out[5]=r.ru_nivcsw;
 return 0;
}
/* Test-adapter gate shared by the two serving processes and third mutator. */
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
static double monotonic_us(void) { struct timespec t; if(clock_gettime(CLOCK_MONOTONIC,&t))return -1; return t.tv_sec*1000000.0+t.tv_nsec/1000.0; }
int native_gate_open(const char *path) { return open(path, O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW, 0600); }
int native_gate_lock(int fd, double *times) { times[0]=monotonic_us(); int r=flock(fd, LOCK_EX); times[1]=monotonic_us(); return r; }
int native_gate_unlock(int fd, double *times) { int r=flock(fd, LOCK_UN); times[2]=monotonic_us(); return r; }
int native_gate_close(int fd) { return close(fd); }
/* Bun's process-relative clocks are not a cross-process latency instrument. */
double native_now_us(void) { return monotonic_us(); }
