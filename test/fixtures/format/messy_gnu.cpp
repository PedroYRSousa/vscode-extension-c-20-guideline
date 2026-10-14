#include <vector>

namespace gnu
{
  template<typename T>
    struct Stack
    {
      void push (const T& x) { data.push_back (x); }
      T pop ()
      {
        T r = data.back ();
        data.pop_back ();
        return r;
      }
      std::vector<T> data;
    };

  int
  compute (int a, int b,
           int c)
  {
    if (a > b
        && b > c)
      {
        return a;
      }
    else
      return b;
  }
}
