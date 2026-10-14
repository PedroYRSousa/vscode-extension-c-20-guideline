#include <algorithm>
#include <string>
#include <vector>

namespace demo
{
class Widget : public Base
{
public:
	Widget(int a,int b):a_(a),b_(b){}
	~Widget(){}
	int get() const{return a_;}
	void set(const std::string &s,std::vector<int> const &v)
	{
		if(a_>0)
		{
			name_=s;
		}
		else if (b_ < 0) { name_ = ""; }
		else
			name_ = "x";
		for(int i=0;i<10;++i)
		{
			total_+=v[ i ];
			if(i==3) continue;
		}
		while(a_>0) --a_;
		switch(b_)
		{
			case 0: a_=1; break;
			case 1:
			{
				a_ = 2;
				break;
			}
			default: break;
		}
		try { risky(); } catch(const std::exception &e) { handle(e); }
	}
private:
	int a_,b_;
	std::string name_;
	long total_ = 12345678;
	unsigned mask_ = 0xFFFFFFFF;
};

struct Pair { int first; int second; };

enum class Color { red, green, blue };

template <typename T> T const & max_of(T const & a,T const & b) { return a<b?b:a; }

int free_function(int *p,int &r,char const *s)
{
	int x=1;int y=2;
	auto f=[&](int v){return v+x;};
	auto g=[&](int v){ x+=v; y+=v; };
	g(f(3));
	return p?*p+r:0;
}
}
